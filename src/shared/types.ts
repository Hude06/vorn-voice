import modelCatalog from "./modelCatalog.json";
import { detectDesktopPlatform, type DesktopPlatform } from "./platform";

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

export interface SpeechStats {
  totalWords: number;
  totalDurationMs: number;
  sampleCount: number;
  lastSampleId: string | null;
  lastSampleWpm: number | null;
  dailyWordBuckets: Record<string, number>;
}

export interface WhisperModel {
  id: string;
  name: string;
  downloadUrl: string;
  fileName: string;
  details: string;
}

type ModelCatalogConfig = {
  defaultModelId: string;
  bundledModelIds: string[];
  models: WhisperModel[];
};

const MODEL_CONFIG = modelCatalog as ModelCatalogConfig;

export const DEFAULT_MODEL_ID = MODEL_CONFIG.defaultModelId;
export const BUNDLED_MODEL_IDS = [...MODEL_CONFIG.bundledModelIds];

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
  soxFound: boolean;
  soxPath?: string;
  managementMode: "installable" | "bundled-only";
  actionLabel: string;
  recoveryMessage?: string;
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

export type MicrophoneAccessStatus = "granted" | "denied" | "restricted" | "not-determined" | "unknown";

export interface PermissionsSnapshot {
  platform: DesktopPlatform;
  microphone: MicrophoneAccessStatus;
  autoPasteAccessGranted: boolean;
  autoPasteAccessRequired: boolean;
  autoPasteAccessLabel: string;
  autoPasteSupported: boolean;
  autoPasteStatusMessage?: string;
  canOpenMicrophoneSettings: boolean;
  canOpenAutoPasteSettings: boolean;
  hotkeyReady: boolean;
  hotkeyMessage?: string;
}

export interface UpdateStatus {
  enabled: boolean;
  label: string;
  canInstall: boolean;
}

export type SystemSettingsTarget = "auto-paste" | "microphone";

export interface OnboardingState {
  completed: boolean;
  version: number;
  completedAt?: number;
  dictationVerified?: boolean;
  dictationVerifiedAt?: number;
  verifiedModelId?: string;
  verifiedHotkeyBehavior?: HotkeyBehavior;
  verifiedShortcut?: KeyboardShortcut;
}

export interface OnboardingDictationResult {
  transcript: string;
  wordCount: number;
  durationMs: number;
  modelId: string;
  autoPasteEnabled: boolean;
  autoPasteAccessReady: boolean;
}

export type OnboardingVerificationStatus = "idle" | "armed" | "listening" | "transcribing" | "passed" | "failed";

export interface OnboardingVerificationState {
  status: OnboardingVerificationStatus;
  hotkeyBehavior: HotkeyBehavior;
  shortcut: KeyboardShortcut;
  result?: OnboardingDictationResult;
  errorMessage?: string;
}

export type SettingsWindowMode = "settings" | "onboarding";

export interface VoicebarApi {
  getState(): Promise<AppSnapshot>;
  getSpeechStats(): Promise<SpeechStats>;
  getAppVersion(): Promise<string>;
  saveSettings(settings: AppSettings): Promise<AppSnapshot>;
  getUpdateState(): Promise<UpdateStatus>;
  checkForUpdatesManual(): Promise<UpdateStatus>;
  installDownloadedUpdate(): Promise<boolean>;
  getOnboardingState(): Promise<OnboardingState>;
  updateOnboardingState(partial?: Partial<OnboardingState>): Promise<OnboardingState>;
  completeOnboarding(partial?: Partial<OnboardingState>): Promise<OnboardingState>;
  resetOnboarding(): Promise<OnboardingState>;
  getOnboardingVerificationState(): Promise<OnboardingVerificationState>;
  armOnboardingVerification(): Promise<OnboardingVerificationState>;
  resetOnboardingVerification(): Promise<OnboardingVerificationState>;
  openSettings(mode?: SettingsWindowMode): Promise<boolean>;
  listModels(): Promise<ModelListItem[]>;
  downloadModel(modelId: string): Promise<boolean>;
  removeModel(modelId: string): Promise<boolean>;
  startHotkeyCapture(): Promise<boolean>;
  cancelHotkeyCapture(): Promise<boolean>;
  requestMicrophonePermission(): Promise<boolean>;
  openSystemSettings(target?: SystemSettingsTarget): Promise<boolean>;
  checkPermissions(): Promise<PermissionsSnapshot>;
  getSpeechRuntimeDiagnostics(): Promise<SpeechRuntimeDiagnostics>;
  installSpeechRuntime(): Promise<SpeechRuntimeDiagnostics>;
  onStateChanged(callback: (snapshot: AppSnapshot) => void): () => void;
  onOnboardingVerificationChanged(callback: (state: OnboardingVerificationState) => void): () => void;
  onUpdateStateChanged(callback: (status: UpdateStatus) => void): () => void;
  onOverlayUpdate(callback: (payload: OverlayPayload) => void): () => void;
  onHotkeyCaptured(callback: (shortcut: KeyboardShortcut) => void): () => void;
  onModelDownloadProgress(callback: (payload: ModelDownloadProgressPayload) => void): () => void;
}

export const ONBOARDING_VERSION = 1;

export const DEFAULT_ONBOARDING_STATE: OnboardingState = {
  completed: false,
  dictationVerified: false,
  version: ONBOARDING_VERSION
};

export function defaultShortcutForPlatform(platform: DesktopPlatform = detectDesktopPlatform()): KeyboardShortcut {
  if (platform === "windows" || platform === "linux") {
    return {
      keyCode: 19,
      modifiers: ["ctrl", "shift"],
      display: "Ctrl + Shift + R"
    };
  }

  return {
    keyCode: 19,
    modifiers: ["cmd", "shift"],
    display: "Shift + Command + R"
  };
}

export function defaultSettingsForPlatform(platform: DesktopPlatform = detectDesktopPlatform()): AppSettings {
  return {
    shortcut: defaultShortcutForPlatform(platform),
    hotkeyBehavior: "hold",
    activeModelId: DEFAULT_MODEL_ID,
    lowLatencyCaptureEnabled: true,
    preRollMs: 350,
    postRollMs: 220,
    autoPaste: false,
    speechCleanupMode: "balanced",
    restoreClipboard: true,
    autoUpdateEnabled: true
  };
}

export const DEFAULT_SETTINGS: AppSettings = defaultSettingsForPlatform();

export const MODEL_CATALOG: WhisperModel[] = MODEL_CONFIG.models.map((model) => ({ ...model }));
