import { AppState } from "./state/appState";
import { AudioCaptureService } from "./services/audioCaptureService";
import { HotkeyService } from "./services/hotkeyService";
import { ModelManager } from "./services/modelManager";
import { PasteService } from "./services/pasteService";
import { PermissionService } from "./services/permissionService";
import { SettingsStore } from "./services/settingsStore";
import { WhisperService } from "./services/whisperService";
import { OverlayWindow } from "./windows/overlayWindow";
import { AppSettings, DEFAULT_SETTINGS, OnboardingDictationResult, SpeechPipelineDiagnostics } from "../shared/types";
import { validateShortcut } from "../shared/shortcuts";
import { computeWpm, countWords, MIN_SPEECH_SAMPLE_DURATION_MS } from "../shared/speechStats";
import fs from "node:fs/promises";

type CaptureOrigin = "hotkey" | "onboarding";

type StopCaptureOptions = {
  origin: CaptureOrigin;
  overlaySuccessMessage: string;
  shouldAutoPaste: boolean;
};

export class AppCoordinator {
  private isRecording = false;
  private isStartingCapture = false;
  private stopPending = false;
  private runToken = 0;
  private recordingStartedAt?: number;
  private captureOrigin: CaptureOrigin | null = null;

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
        void this.handlePressEvent();
      },
      () => {
        void this.handleReleaseEvent();
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

  async startOnboardingDictationTest(): Promise<void> {
    await this.handleStart("onboarding");
  }

  async finishOnboardingDictationTest(): Promise<OnboardingDictationResult> {
    if (this.isStartingCapture) {
      throw new Error("Wait for the test recording to start before stopping it.");
    }

    if (!this.isRecording || this.captureOrigin !== "onboarding") {
      throw new Error("Start a test dictation before stopping it.");
    }

    return this.handleStop({
      origin: "onboarding",
      overlaySuccessMessage: "Test complete",
      shouldAutoPaste: false
    });
  }

  private async handlePressEvent(): Promise<void> {
    if (this.captureOrigin === "onboarding") {
      return;
    }

    const behavior = this.state.getSnapshot().settings.hotkeyBehavior;

    if (behavior === "toggle" && (this.isRecording || this.isStartingCapture)) {
      try {
        await this.handleStop(stopOptionsForOrigin("hotkey"));
      } catch {
        // state and overlay are already updated inside handleStop
      }
      return;
    }

    await this.handleStart("hotkey");
  }

  private async handleReleaseEvent(): Promise<void> {
    if (this.captureOrigin === "onboarding") {
      return;
    }

    const behavior = this.state.getSnapshot().settings.hotkeyBehavior;

    if (behavior === "toggle") {
      return;
    }

    try {
      await this.handleStop(stopOptionsForOrigin("hotkey"));
    } catch {
      // state and overlay are already updated inside handleStop
    }
  }

  private async handleStart(origin: CaptureOrigin): Promise<void> {
    if (this.isRecording || this.isStartingCapture) {
      if (origin === "onboarding") {
        throw new Error("A recording is already in progress.");
      }

      return;
    }

    this.runToken += 1;
    const token = this.runToken;
    this.recordingStartedAt = Date.now();
    this.isStartingCapture = true;

    let allowed = this.permissionService.getMicrophonePermissionStatus() === "granted";
    if (!allowed) {
      allowed = await this.permissionService.requestMicrophonePermission();
    }

    if (!allowed || token !== this.runToken) {
      this.isStartingCapture = false;
      this.recordingStartedAt = undefined;
      this.stopPending = false;
      this.captureOrigin = null;
      this.state.setMode("error", "Microphone permission is required");
      if (origin === "onboarding") {
        throw new Error("Microphone permission is required");
      }
      return;
    }

    if (this.stopPending) {
      this.isStartingCapture = false;
      this.recordingStartedAt = undefined;
      this.stopPending = false;
      this.captureOrigin = null;
      return;
    }

    this.captureOrigin = origin;
    this.state.setMode("listening");
    this.overlay.show("listening", "Listening...");

    try {
      await this.audioCapture.startCapture();
      this.isStartingCapture = false;
      this.isRecording = true;
      if (this.stopPending) {
        this.stopPending = false;
        void this.handleStop(stopOptionsForOrigin(origin)).catch(() => undefined);
      }
    } catch (error) {
      this.isStartingCapture = false;
      this.stopPending = false;
      this.recordingStartedAt = undefined;
      this.captureOrigin = null;
      const message = toErrorMessage(error, "Audio capture failed");
      this.state.setMode("error", message);
      this.overlay.show("message", message);
      this.overlay.hide(1200);
      if (origin === "onboarding") {
        throw new Error(message);
      }
    }
  }

  private async handleStop(options: StopCaptureOptions): Promise<OnboardingDictationResult> {
    if (this.isStartingCapture) {
      this.stopPending = true;
      throw new Error("Wait for the recording to start before stopping it.");
    }

    if (!this.isRecording) {
      throw new Error("No recording is currently in progress.");
    }

    this.stopPending = false;

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
      this.captureOrigin = null;
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
      throw new Error(message);
    }

    const recordingStartedAt = this.recordingStartedAt ?? recordingEndedAt;
    const durationMs = Math.max(0, recordingEndedAt - recordingStartedAt);
    this.recordingStartedAt = undefined;
    this.captureOrigin = null;

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

      if (options.shouldAutoPaste && snapshot.settings.autoPaste) {
        const accessibilityAllowed = this.permissionService.checkAccessibilityPermission(true);
        if (!accessibilityAllowed) {
          throw new Error("Accessibility permission is required for paste automation");
        }

        await this.pasteService.pasteText(transcript, snapshot.settings.restoreClipboard);
        this.overlay.show("message", "Inserted text");
      } else {
        this.overlay.show("message", options.overlaySuccessMessage);
      }
      this.overlay.hide(900);

      return {
        transcript,
        wordCount: words,
        durationMs,
        modelId: snapshot.settings.activeModelId,
        autoPasteEnabled: snapshot.settings.autoPaste,
        accessibilityReady: snapshot.settings.autoPaste
          ? this.permissionService.checkAccessibilityPermission(false)
          : true
      };
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
      throw new Error(message);
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

function stopOptionsForOrigin(origin: CaptureOrigin): StopCaptureOptions {
  if (origin === "onboarding") {
    return {
      origin,
      overlaySuccessMessage: "Test complete",
      shouldAutoPaste: false
    };
  }

  return {
    origin,
    overlaySuccessMessage: "Transcribed",
    shouldAutoPaste: true
  };
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
