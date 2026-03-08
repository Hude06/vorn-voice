export type AppMode = "idle" | "listening" | "transcribing" | "error";

export type Modifier = "cmd" | "shift" | "alt" | "ctrl";

export interface KeyboardShortcut {
  keyCode: number;
  modifiers: Modifier[];
  display?: string;
}

export interface AppSettings {
  shortcut: KeyboardShortcut;
  hotkeyBehavior: HotkeyBehavior;
  activeModelId: string;
  speechCleanupMode: SpeechCleanupMode;
  lowLatencyCaptureEnabled: boolean;
  preRollMs: number;
  postRollMs: number;
  autoPaste: boolean;
  restoreClipboard: boolean;
  autoUpdateEnabled: boolean;
}

export type HotkeyBehavior = "hold" | "toggle";

export type SpeechCleanupMode = "off" | "balanced" | "aggressive";

export interface AudioSignalStats {
  durationSeconds: number;
  maxAmplitude: number;
  rmsAmplitude: number;
}

export interface SpeechCaptureDiagnostics {
  requestedCleanupMode: SpeechCleanupMode;
  appliedCleanupMode: SpeechCleanupMode;
  fallbackUsed: boolean;
  captureBackend: "persistent" | "spawn";
  preRollMsRequested?: number;
  preRollMsDelivered?: number;
  postRollMsRequested?: number;
  postRollMsDelivered?: number;
  keydownToCaptureReadyMs?: number;
  keyupToCaptureStoppedMs?: number;
  raw: AudioSignalStats;
  final: AudioSignalStats;
}

export interface WhisperTranscriptionDiagnostics {
  runtimePath: string;
  modelId: string;
  modelPath: string;
  audioDurationSeconds?: number;
  chunked: boolean;
  chunkCount: number;
  blankChunkCount: number;
}

export interface SpeechPipelineDiagnostics {
  recordedAt: number;
  requestedCleanupMode: SpeechCleanupMode;
  capture?: SpeechCaptureDiagnostics;
  transcription?: WhisperTranscriptionDiagnostics;
  lastError?: string;
}

export interface SpeechSample {
  id: string;
  words: number;
  durationMs: number;
  wpm: number;
  createdAt: number;
}

export interface WhisperModel {
  id: string;
  name: string;
  downloadUrl: string;
  fileName: string;
  details: string;
}

export interface AppSnapshot {
  mode: AppMode;
  errorMessage?: string;
  lastTranscriptPreview: string;
  lastTranscriptWordCount: number;
  lastTranscriptTruncated: boolean;
  settings: AppSettings;
  lastSpeechSample?: SpeechSample;
  lastSpeechDiagnostics?: SpeechPipelineDiagnostics;
}

export interface SpeechRuntimeDiagnostics {
  whisperCliFound: boolean;
  whisperCliPath?: string;
  checkedPaths: string[];
  pathEnv: string;
}

export type OverlayType = "listening" | "transcribing" | "message";

export interface OverlayPayload {
  type: OverlayType;
  text?: string;
}

export interface ModelDownloadProgressPayload {
  modelId: string;
  percent: number;
}

export interface ModelListItem {
  id: string;
  name: string;
  details: string;
  installed: boolean;
}

export interface PermissionsSnapshot {
  accessibility: boolean;
  microphone: "granted" | "denied" | "restricted" | "not-determined" | "unknown";
  hotkeyReady: boolean;
  hotkeyMessage?: string;
}

export interface UpdateStatus {
  enabled: boolean;
  label: string;
  canInstall: boolean;
}

export type PrivacyPane = "accessibility" | "microphone";

export interface OnboardingState {
  completed: boolean;
  version: number;
  completedAt?: number;
  selectedModelId?: string;
}

export type SettingsWindowMode = "settings" | "onboarding";

export interface VoicebarApi {
  getState(): Promise<AppSnapshot>;
  getAppVersion(): Promise<string>;
  saveSettings(settings: AppSettings): Promise<AppSnapshot>;
  getUpdateState(): Promise<UpdateStatus>;
  checkForUpdatesManual(): Promise<UpdateStatus>;
  installDownloadedUpdate(): Promise<boolean>;
  getOnboardingState(): Promise<OnboardingState>;
  completeOnboarding(partial?: Partial<OnboardingState>): Promise<OnboardingState>;
  resetOnboarding(): Promise<OnboardingState>;
  openSettings(mode?: SettingsWindowMode): Promise<boolean>;
  listModels(): Promise<ModelListItem[]>;
  downloadModel(modelId: string): Promise<boolean>;
  removeModel(modelId: string): Promise<boolean>;
  startHotkeyCapture(): Promise<boolean>;
  cancelHotkeyCapture(): Promise<boolean>;
  requestMicrophonePermission(): Promise<boolean>;
  openPrivacySettings(pane?: PrivacyPane): Promise<boolean>;
  checkPermissions(): Promise<PermissionsSnapshot>;
  getSpeechRuntimeDiagnostics(): Promise<SpeechRuntimeDiagnostics>;
  installSpeechRuntime(): Promise<SpeechRuntimeDiagnostics>;
  onStateChanged(callback: (snapshot: AppSnapshot) => void): () => void;
  onUpdateStateChanged(callback: (status: UpdateStatus) => void): () => void;
  onOverlayUpdate(callback: (payload: OverlayPayload) => void): () => void;
  onHotkeyCaptured(callback: (shortcut: KeyboardShortcut) => void): () => void;
  onModelDownloadProgress(callback: (payload: ModelDownloadProgressPayload) => void): () => void;
}

export const ONBOARDING_VERSION = 1;

export const DEFAULT_ONBOARDING_STATE: OnboardingState = {
  completed: false,
  version: ONBOARDING_VERSION
};

export const DEFAULT_SETTINGS: AppSettings = {
  shortcut: {
    keyCode: 19,
    modifiers: ["cmd", "shift"],
    display: "Shift + Command + R"
  },
  hotkeyBehavior: "hold",
  activeModelId: "small.en",
  lowLatencyCaptureEnabled: true,
  preRollMs: 350,
  postRollMs: 220,
  autoPaste: false,
  speechCleanupMode: "balanced",
  restoreClipboard: true,
  autoUpdateEnabled: true
};

export const MODEL_CATALOG: WhisperModel[] = [
  {
    id: "tiny.en",
    name: "Tiny (English)",
    downloadUrl: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin",
    fileName: "ggml-tiny.en.bin",
    details: "Fastest, lower accuracy"
  },
  {
    id: "base.en",
    name: "Base (English)",
    downloadUrl: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
    fileName: "ggml-base.en.bin",
    details: "Balanced speed and quality"
  },
  {
    id: "small.en",
    name: "Small (English)",
    downloadUrl: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin",
    fileName: "ggml-small.en.bin",
    details: "Best bundled quality, slower"
  }
];
