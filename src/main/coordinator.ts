import { AppState } from "./state/appState";
import { AudioCaptureService } from "./services/audioCaptureService";
import { HotkeyService } from "./services/hotkeyService";
import { ModelManager } from "./services/modelManager";
import { PasteService } from "./services/pasteService";
import { PermissionService } from "./services/permissionService";
import { SpeechStatsStore } from "./services/speechStatsStore";
import { SettingsStore } from "./services/settingsStore";
import { WhisperService } from "./services/whisperService";
import { OverlayWindow } from "./windows/overlayWindow";
import {
  AppSettings,
  DEFAULT_SETTINGS,
  OnboardingDictationResult,
  OnboardingVerificationState,
  SpeechPipelineDiagnostics
} from "../shared/types";
import { validateShortcut } from "../shared/shortcuts";
import { computeWpm, countWords, MIN_SPEECH_SAMPLE_DURATION_MS } from "../shared/speechStats";
import fs from "node:fs/promises";

type CaptureOrigin = "hotkey" | "onboarding";

type StopCaptureOptions = {
  origin: CaptureOrigin;
  overlaySuccessMessage: string;
  shouldAutoPaste: boolean;
};

type OnboardingVerificationListener = (state: OnboardingVerificationState) => void;

export class AppCoordinator {
  private isRecording = false;
  private isStartingCapture = false;
  private stopPending = false;
  private runToken = 0;
  private recordingStartedAt?: number;
  private captureOrigin: CaptureOrigin | null = null;
  private onboardingVerification: OnboardingVerificationState;
  private readonly onboardingVerificationListeners = new Set<OnboardingVerificationListener>();

  constructor(
    private readonly state: AppState,
    private readonly store: SettingsStore,
    private readonly hotkey: HotkeyService,
    private readonly audioCapture: AudioCaptureService,
    private readonly whisper: WhisperService,
    private readonly modelManager: ModelManager,
    private readonly pasteService: PasteService,
    private readonly permissionService: PermissionService,
    private readonly speechStatsStore: SpeechStatsStore,
    private readonly overlay: OverlayWindow
  ) {
    this.onboardingVerification = createOnboardingVerificationState(this.state.getSnapshot().settings);
  }

  start(): string | undefined {
    this.hotkey.setHandlers(
      () => {
        void this.handlePressEvent().catch(() => undefined);
      },
      () => {
        void this.handleReleaseEvent().catch(() => undefined);
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
    const previousSettings = this.state.getSnapshot().settings;
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

    if (
      !sameShortcut(previousSettings.shortcut, settings.shortcut)
      || previousSettings.activeModelId !== settings.activeModelId
      || previousSettings.hotkeyBehavior !== settings.hotkeyBehavior
    ) {
      this.resetOnboardingVerification();
    } else {
      this.syncOnboardingVerification(settings);
    }
  }

  getOnboardingVerificationState(): OnboardingVerificationState {
    return { ...this.onboardingVerification };
  }

  armOnboardingVerification(): OnboardingVerificationState {
    this.updateOnboardingVerification({
      status: "armed",
      hotkeyBehavior: this.state.getSnapshot().settings.hotkeyBehavior,
      shortcut: this.state.getSnapshot().settings.shortcut,
      result: undefined,
      errorMessage: undefined
    });

    return this.getOnboardingVerificationState();
  }

  resetOnboardingVerification(): OnboardingVerificationState {
    this.updateOnboardingVerification(createOnboardingVerificationState(this.state.getSnapshot().settings));
    return this.getOnboardingVerificationState();
  }

  onOnboardingVerificationChanged(listener: OnboardingVerificationListener): () => void {
    this.onboardingVerificationListeners.add(listener);
    return () => {
      this.onboardingVerificationListeners.delete(listener);
    };
  }

  private async handlePressEvent(): Promise<void> {
    const behavior = this.state.getSnapshot().settings.hotkeyBehavior;
    const activeOrigin = this.captureOrigin ?? (this.onboardingVerification.status === "armed" ? "onboarding" : "hotkey");

    if (behavior === "toggle" && (this.isRecording || this.isStartingCapture)) {
      try {
        await this.handleStop(stopOptionsForOrigin(this.captureOrigin ?? activeOrigin));
      } catch {
        // state and overlay are already updated inside handleStop
      }
      return;
    }

    await this.handleStart(activeOrigin);
  }

  private async handleReleaseEvent(): Promise<void> {
    const behavior = this.state.getSnapshot().settings.hotkeyBehavior;

    if (behavior === "toggle") {
      return;
    }

    try {
      await this.handleStop(stopOptionsForOrigin(this.captureOrigin ?? "hotkey"));
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

    const preflightStatus = this.permissionService.getMicrophonePreflightStatus();
    let allowed = preflightStatus === "granted" || preflightStatus === "retryable";
    if (!allowed && preflightStatus === "requestable") {
      allowed = await this.permissionService.requestMicrophonePermission();
    }

    if (!allowed || token !== this.runToken) {
      this.isStartingCapture = false;
      this.recordingStartedAt = undefined;
      this.stopPending = false;
      this.captureOrigin = null;
      const message = this.permissionService.getMicrophoneDeniedMessage();
      this.state.setMode("error", message);
      if (origin === "onboarding") {
        this.updateOnboardingVerification({
          status: "failed",
          result: undefined,
          errorMessage: message
        });
        throw new Error(message);
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
    if (origin === "onboarding") {
      this.updateOnboardingVerification({
        status: "listening",
        result: undefined,
        errorMessage: undefined
      });
    }

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
      const message = toCaptureStartMessage(error, preflightStatus, this.permissionService);
      this.state.setMode("error", message);
      this.overlay.show("message", message);
      this.overlay.hide(1200);
      if (origin === "onboarding") {
        this.updateOnboardingVerification({
          status: "failed",
          result: undefined,
          errorMessage: message
        });
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
      if (options.origin === "onboarding") {
        this.updateOnboardingVerification({
          status: "transcribing",
          result: undefined,
          errorMessage: undefined
        });
      }
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
      if (options.origin === "onboarding") {
        this.updateOnboardingVerification({
          status: "failed",
          result: undefined,
          errorMessage: message
        });
      }
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
        const sample = {
          id: `${createdAt}-${Math.floor(Math.random() * 1000000)}`,
          words,
          durationMs,
          wpm: computeWpm(words, durationMs),
          createdAt
        };

        try {
          this.speechStatsStore.recordSample(sample);
        } catch (error) {
          const message = toErrorMessage(error, "Dictation worked, but speech stats could not be saved.");
          this.state.setMode("idle", message);
        }
        this.state.setSpeechSample(sample);
      }

      if (options.shouldAutoPaste && snapshot.settings.autoPaste) {
        const autoPasteAccessAllowed = this.permissionService.checkAutoPasteAccess(true);
        if (!autoPasteAccessAllowed) {
          throw new Error(this.permissionService.getAutoPasteAccessDeniedMessage());
        }

        await this.pasteService.pasteText(transcript, snapshot.settings.restoreClipboard);
        this.overlay.show("message", "Inserted text");
      } else {
        this.overlay.show("message", options.overlaySuccessMessage);
      }
      this.overlay.hide(900);

      const result = {
        transcript,
        wordCount: words,
        durationMs,
        modelId: snapshot.settings.activeModelId,
        autoPasteEnabled: snapshot.settings.autoPaste,
        autoPasteAccessReady: snapshot.settings.autoPaste
          ? this.permissionService.checkAutoPasteAccess(false)
          : true
      };

      if (options.origin === "onboarding") {
        this.updateOnboardingVerification({
          status: "passed",
          result,
          errorMessage: undefined
        });
      }

      return result;
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
      if (options.origin === "onboarding") {
        this.updateOnboardingVerification({
          status: "failed",
          result: undefined,
          errorMessage: message
        });
      }
      throw new Error(message);
    } finally {
      await fs.unlink(audioPath).catch(() => undefined);
    }
  }

  private syncOnboardingVerification(settings: AppSettings): void {
    this.updateOnboardingVerification({
      shortcut: settings.shortcut,
      hotkeyBehavior: settings.hotkeyBehavior
    });
  }

  private updateOnboardingVerification(next: OnboardingVerificationState): void;
  private updateOnboardingVerification(next: Partial<OnboardingVerificationState>): void;
  private updateOnboardingVerification(next: OnboardingVerificationState | Partial<OnboardingVerificationState>): void {
    this.onboardingVerification = {
      ...this.onboardingVerification,
      ...next
    };

    const snapshot = this.getOnboardingVerificationState();
    this.onboardingVerificationListeners.forEach((listener) => {
      listener(snapshot);
    });
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

function createOnboardingVerificationState(settings: AppSettings): OnboardingVerificationState {
  return {
    status: "idle",
    hotkeyBehavior: settings.hotkeyBehavior,
    shortcut: settings.shortcut
  };
}

function isNonFatalMessage(message: string): boolean {
  return message === "No speech detected" || message.startsWith("Input too quiet");
}

function toCaptureStartMessage(
  error: unknown,
  preflightStatus: ReturnType<PermissionService["getMicrophonePreflightStatus"]>,
  permissionService: PermissionService
): string {
  const message = toErrorMessage(error, "Audio capture failed");

  if (preflightStatus !== "granted" && isMicrophoneAccessMessage(message)) {
    return permissionService.getMicrophoneDeniedMessage();
  }

  return message;
}

function isMicrophoneAccessMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("permission denied")
    || normalized.includes("access denied")
    || normalized.includes("device unavailable")
    || normalized.includes("microphone")
  );
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}
