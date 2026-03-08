import { AppState } from "./state/appState";
import { AudioCaptureService } from "./services/audioCaptureService";
import { HotkeyService } from "./services/hotkeyService";
import { ModelManager } from "./services/modelManager";
import { PasteService } from "./services/pasteService";
import { PermissionService } from "./services/permissionService";
import { SettingsStore } from "./services/settingsStore";
import { WhisperService } from "./services/whisperService";
import { OverlayWindow } from "./windows/overlayWindow";
import { AppSettings, DEFAULT_SETTINGS, SpeechPipelineDiagnostics } from "../shared/types";
import { validateShortcut } from "../shared/shortcuts";
import { computeWpm, countWords, MIN_SPEECH_SAMPLE_DURATION_MS } from "../shared/speechStats";
import fs from "node:fs/promises";

export class AppCoordinator {
  private isRecording = false;
  private isStartingCapture = false;
  private releasePending = false;
  private runToken = 0;
  private recordingStartedAt?: number;

  constructor(
    private readonly state: AppState,
    private readonly store: SettingsStore,
    private readonly hotkey: HotkeyService,
    private readonly audioCapture: AudioCaptureService,
    private readonly whisper: WhisperService,
    private readonly modelManager: ModelManager,
    private readonly pasteService: PasteService,
    private readonly permissionService: PermissionService,
    private readonly overlay: OverlayWindow
  ) {}

  start(): string | undefined {
    this.hotkey.setHandlers(
      () => {
        void this.handlePress();
      },
      () => {
        void this.handleRelease();
      }
    );

    const settings = this.state.getSnapshot().settings;
    const fallbackSettings: AppSettings = {
      ...settings,
      shortcut: DEFAULT_SETTINGS.shortcut
    };

    try {
      this.audioCapture.configureRealtimeCapture({
        lowLatencyEnabled: settings.lowLatencyCaptureEnabled,
        preRollMs: settings.preRollMs,
        postRollMs: settings.postRollMs
      });
      this.hotkey.register(settings.shortcut);
      this.hotkey.warmup();
      void this.audioCapture.prewarmCapture().catch(() => undefined);
      return this.hotkey.getStatusError();
    } catch (error) {
      if (sameShortcut(settings.shortcut, DEFAULT_SETTINGS.shortcut)) {
        const message = toErrorMessage(error, "Failed to register hotkey. Choose a different shortcut.");
        this.state.setMode("error", message);
        return message;
      }

      try {
        this.hotkey.register(DEFAULT_SETTINGS.shortcut);
        this.store.save(fallbackSettings);
        this.state.setSettings(fallbackSettings);
        const hookWarning = this.hotkey.getStatusError();
        const message = hookWarning ?? "Saved shortcut was unavailable. Reverted to the default hotkey.";
        this.state.setMode("error", message);
        return message;
      } catch (fallbackError) {
        const message = toErrorMessage(fallbackError, "Failed to register hotkey. Choose a different shortcut.");
        this.state.setMode("error", message);
        return message;
      }
    }
  }

  stop(): void {
    this.hotkey.unregisterAll();
    void this.audioCapture.shutdown().catch(() => undefined);
  }

  updateSettings(settings: AppSettings): void {
    const shortcutError = validateShortcut(settings.shortcut);
    if (shortcutError) {
      throw new Error(shortcutError);
    }

    this.hotkey.register(settings.shortcut);
    this.audioCapture.configureRealtimeCapture({
      lowLatencyEnabled: settings.lowLatencyCaptureEnabled,
      preRollMs: settings.preRollMs,
      postRollMs: settings.postRollMs
    });
    void this.audioCapture.prewarmCapture().catch(() => undefined);

    this.store.save(settings);
    this.state.setSettings(settings);
  }

  private async handlePress(): Promise<void> {
    if (this.isRecording || this.isStartingCapture) {
      return;
    }

    this.runToken += 1;
    const token = this.runToken;
    this.recordingStartedAt = Date.now();

    let allowed = this.permissionService.getMicrophonePermissionStatus() === "granted";
    if (!allowed) {
      allowed = await this.permissionService.requestMicrophonePermission();
    }

    if (!allowed || token !== this.runToken) {
      this.recordingStartedAt = undefined;
      this.state.setMode("error", "Microphone permission is required");
      return;
    }

    this.state.setMode("listening");
    this.overlay.show("listening", "Listening...");
    this.isStartingCapture = true;

    try {
      await this.audioCapture.startCapture();
      this.isStartingCapture = false;
      this.isRecording = true;
      if (this.releasePending) {
        this.releasePending = false;
        void this.handleRelease();
      }
    } catch (error) {
      this.isStartingCapture = false;
      this.recordingStartedAt = undefined;
      const message = toErrorMessage(error, "Audio capture failed");
      this.state.setMode("error", message);
      this.overlay.show("message", message);
      this.overlay.hide(1200);
    }
  }

  private async handleRelease(): Promise<void> {
    if (this.isStartingCapture) {
      this.releasePending = true;
      return;
    }

    if (!this.isRecording) {
      return;
    }

    this.releasePending = false;

    let audioPath: string;
    let diagnostics: SpeechPipelineDiagnostics | undefined;
    const recordingEndedAt = Date.now();
    try {
      const settings = this.state.getSnapshot().settings;
      audioPath = await this.audioCapture.stopCapture(settings.speechCleanupMode);
      diagnostics = {
        recordedAt: recordingEndedAt,
        requestedCleanupMode: settings.speechCleanupMode,
        capture: this.audioCapture.getLastDiagnostics()
      };
      this.isRecording = false;
      this.state.setMode("transcribing");
      this.overlay.show("transcribing", "Transcribing...");
    } catch (error) {
      this.isRecording = false;
      this.recordingStartedAt = undefined;
      const message = toErrorMessage(error, "Could not stop recording");
      this.state.setSpeechDiagnostics({
        recordedAt: recordingEndedAt,
        requestedCleanupMode: this.state.getSnapshot().settings.speechCleanupMode,
        capture: this.audioCapture.getLastDiagnostics(),
        lastError: message
      });
      if (isNonFatalMessage(message)) {
        this.state.setMode("idle", message);
        this.overlay.show("message", message);
      } else {
        this.state.setMode("error", message);
        this.overlay.show("message", message);
      }
      this.overlay.hide(1200);
      return;
    }

    const recordingStartedAt = this.recordingStartedAt ?? recordingEndedAt;
    const durationMs = Math.max(0, recordingEndedAt - recordingStartedAt);
    this.recordingStartedAt = undefined;

    try {
      const snapshot = this.state.getSnapshot();
      const modelPath = await this.resolveTranscriptionModelPath(snapshot.settings.activeModelId);
      const transcript = await this.whisper.transcribe(audioPath, modelPath, snapshot.settings.activeModelId);
      this.state.setSpeechDiagnostics({
        recordedAt: recordingEndedAt,
        requestedCleanupMode: snapshot.settings.speechCleanupMode,
        capture: diagnostics?.capture,
        transcription: this.whisper.getLastDiagnostics()
      });

      this.state.setTranscript(transcript);
      this.state.setMode("idle");

      const words = countWords(transcript);
      if (words > 0 && durationMs >= MIN_SPEECH_SAMPLE_DURATION_MS) {
        const createdAt = Date.now();
        this.state.setSpeechSample({
          id: `${createdAt}-${Math.floor(Math.random() * 1000000)}`,
          words,
          durationMs,
          wpm: computeWpm(words, durationMs),
          createdAt
        });
      }

      if (snapshot.settings.autoPaste) {
        const accessibilityAllowed = this.permissionService.checkAccessibilityPermission(true);
        if (!accessibilityAllowed) {
          throw new Error("Accessibility permission is required for paste automation");
        }

        await this.pasteService.pasteText(transcript, snapshot.settings.restoreClipboard);
        this.overlay.show("message", "Inserted text");
      } else {
        this.overlay.show("message", "Transcribed");
      }
      this.overlay.hide(900);
    } catch (error) {
      const message = toErrorMessage(error, "Transcription failed");
      this.state.setSpeechDiagnostics({
        recordedAt: recordingEndedAt,
        requestedCleanupMode: this.state.getSnapshot().settings.speechCleanupMode,
        capture: diagnostics?.capture,
        transcription: this.whisper.getLastDiagnostics(),
        lastError: message
      });
      if (isNonFatalMessage(message)) {
        this.state.setMode("idle", message);
        this.overlay.show("message", message);
      } else {
        this.state.setMode("error", message);
        this.overlay.show("message", message);
      }
      this.overlay.hide(1400);
    } finally {
      await fs.unlink(audioPath).catch(() => undefined);
    }
  }

  private async resolveTranscriptionModelPath(modelId: string): Promise<string> {
    await this.whisper.ensureRuntimeAvailable();
    return this.modelManager.resolveModelPath(modelId);
  }
}

function sameShortcut(left: AppSettings["shortcut"], right: AppSettings["shortcut"]): boolean {
  if (left.keyCode !== right.keyCode || left.modifiers.length !== right.modifiers.length) {
    return false;
  }

  return left.modifiers.every((modifier, index) => modifier === right.modifiers[index]);
}

function isNonFatalMessage(message: string): boolean {
  return message === "No speech detected" || message.startsWith("Input too quiet");
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}
