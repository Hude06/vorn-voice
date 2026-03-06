import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "../main/ipc/channels";
import {
  AppSettings,
  AppSnapshot,
  KeyboardShortcut,
  OnboardingState,
  SettingsWindowMode,
  SpeechRuntimeDiagnostics
} from "../shared/types";

type OverlayPayload = {
  type: "listening" | "transcribing" | "message";
  text?: string;
};

type ModelProgressPayload = {
  modelId: string;
  percent: number;
};

const api = {
  getState(): Promise<AppSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.stateGet);
  },
  saveSettings(settings: AppSettings): Promise<AppSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.settingsSave, settings);
  },
  getOnboardingState(): Promise<OnboardingState> {
    return ipcRenderer.invoke(IPC_CHANNELS.onboardingGet);
  },
  completeOnboarding(partial?: Partial<OnboardingState>): Promise<OnboardingState> {
    return ipcRenderer.invoke(IPC_CHANNELS.onboardingComplete, partial);
  },
  resetOnboarding(): Promise<OnboardingState> {
    return ipcRenderer.invoke(IPC_CHANNELS.onboardingReset);
  },
  openSettings(mode?: SettingsWindowMode): Promise<boolean> {
    return ipcRenderer.invoke(IPC_CHANNELS.settingsOpen, mode);
  },
  listModels(): Promise<Array<{ id: string; name: string; details: string; installed: boolean }>> {
    return ipcRenderer.invoke(IPC_CHANNELS.modelsList);
  },
  downloadModel(modelId: string): Promise<boolean> {
    return ipcRenderer.invoke(IPC_CHANNELS.modelDownload, modelId);
  },
  removeModel(modelId: string): Promise<boolean> {
    return ipcRenderer.invoke(IPC_CHANNELS.modelRemove, modelId);
  },
  startHotkeyCapture(): Promise<boolean> {
    return ipcRenderer.invoke(IPC_CHANNELS.hotkeyCaptureStart);
  },
  cancelHotkeyCapture(): Promise<boolean> {
    return ipcRenderer.invoke(IPC_CHANNELS.hotkeyCaptureCancel);
  },
  openPrivacySettings(): Promise<boolean> {
    return ipcRenderer.invoke(IPC_CHANNELS.permissionsOpenPrivacy);
  },
  checkPermissions(): Promise<{ accessibility: boolean }> {
    return ipcRenderer.invoke(IPC_CHANNELS.permissionsCheck);
  },
  getSpeechRuntimeDiagnostics(): Promise<SpeechRuntimeDiagnostics> {
    return ipcRenderer.invoke(IPC_CHANNELS.speechRuntimeDiagnostics);
  },
  installSpeechRuntime(): Promise<SpeechRuntimeDiagnostics> {
    return ipcRenderer.invoke(IPC_CHANNELS.speechRuntimeInstall);
  },
  onStateChanged(callback: (snapshot: AppSnapshot) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: AppSnapshot) => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.stateChanged, listener);
    return () => {
      ipcRenderer.off(IPC_CHANNELS.stateChanged, listener);
    };
  },
  onOverlayUpdate(callback: (payload: OverlayPayload) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: OverlayPayload) => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.overlayUpdate, listener);
    return () => {
      ipcRenderer.off(IPC_CHANNELS.overlayUpdate, listener);
    };
  },
  onHotkeyCaptured(callback: (shortcut: KeyboardShortcut) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: KeyboardShortcut) => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.hotkeyCaptured, listener);
    return () => {
      ipcRenderer.off(IPC_CHANNELS.hotkeyCaptured, listener);
    };
  },
  onModelDownloadProgress(callback: (payload: ModelProgressPayload) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: ModelProgressPayload) => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.modelDownloadProgress, listener);
    return () => {
      ipcRenderer.off(IPC_CHANNELS.modelDownloadProgress, listener);
    };
  }
};

contextBridge.exposeInMainWorld("voicebar", api);
