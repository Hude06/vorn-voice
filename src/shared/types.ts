export type AppMode = "idle" | "listening" | "transcribing" | "error";

export type Modifier = "cmd" | "shift" | "alt" | "ctrl";

export interface KeyboardShortcut {
  keyCode: number;
  modifiers: Modifier[];
  display?: string;
}

export interface AppSettings {
  shortcut: KeyboardShortcut;
  activeModelId: string;
  autoPaste: boolean;
  restoreClipboard: boolean;
  autoUpdateEnabled: boolean;
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
}

export interface SpeechRuntimeDiagnostics {
  whisperCliFound: boolean;
  whisperCliPath?: string;
  checkedPaths: string[];
  pathEnv: string;
}

export interface OnboardingState {
  completed: boolean;
  version: number;
  completedAt?: number;
  selectedModelId?: string;
}

export type SettingsWindowMode = "settings" | "onboarding";

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
  activeModelId: "base.en",
  autoPaste: true,
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
    details: "Higher quality, slower"
  }
];
