import type { AppSettings, AppSnapshot, KeyboardShortcut, OnboardingState, SpeechRuntimeDiagnostics } from "../shared/types";

type OverlayPayload = {
  type: "listening" | "transcribing" | "message";
  text?: string;
};

type ModelProgressPayload = {
  modelId: string;
  percent: number;
};

declare global {
  interface Window {
    voicebar: {
      getState(): Promise<AppSnapshot>;
      saveSettings(settings: AppSettings): Promise<AppSnapshot>;
      listModels(): Promise<Array<{ id: string; name: string; details: string; installed: boolean }>>;
      downloadModel(modelId: string): Promise<boolean>;
      removeModel(modelId: string): Promise<boolean>;
      startHotkeyCapture(): Promise<boolean>;
      cancelHotkeyCapture(): Promise<boolean>;
      openPrivacySettings(): Promise<boolean>;
      checkPermissions(): Promise<{ accessibility: boolean }>;
      getSpeechRuntimeDiagnostics(): Promise<SpeechRuntimeDiagnostics>;
      installSpeechRuntime(): Promise<SpeechRuntimeDiagnostics>;
      getOnboardingState(): Promise<OnboardingState>;
      completeOnboarding(payload: { selectedModelId?: string }): Promise<OnboardingState>;
      resetOnboarding(): Promise<OnboardingState>;
      onStateChanged(callback: (snapshot: AppSnapshot) => void): () => void;
      onOverlayUpdate(callback: (payload: OverlayPayload) => void): () => void;
      onHotkeyCaptured(callback: (shortcut: KeyboardShortcut) => void): () => void;
      onModelDownloadProgress(callback: (payload: ModelProgressPayload) => void): () => void;
    };
  }
}

export {};
