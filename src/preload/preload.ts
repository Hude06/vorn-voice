import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "../main/ipc/channels";
import {
  AppSettings,
  AppSnapshot,
  KeyboardShortcut,
  ModelDownloadProgressPayload,
  ModelListItem,
  OnboardingState,
  OnboardingVerificationState,
  OverlayPayload,
  PrivacyPane,
  PermissionsSnapshot,
  SettingsWindowMode,
  SpeechRuntimeDiagnostics,
  UpdateStatus,
  VoicebarApi
} from "../shared/types";

const api: VoicebarApi = {
  getState(): Promise<AppSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.stateGet);
  },
  getAppVersion(): Promise<string> {
    return ipcRenderer.invoke(IPC_CHANNELS.appVersionGet);
  },
  saveSettings(settings: AppSettings): Promise<AppSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.settingsSave, settings);
  },
  getUpdateState(): Promise<UpdateStatus> {
    return ipcRenderer.invoke(IPC_CHANNELS.updatesGetState);
  },
  checkForUpdatesManual(): Promise<UpdateStatus> {
    return ipcRenderer.invoke(IPC_CHANNELS.updatesCheckManual);
  },
  installDownloadedUpdate(): Promise<boolean> {
    return ipcRenderer.invoke(IPC_CHANNELS.updatesInstall);
  },
  getOnboardingState(): Promise<OnboardingState> {
    return ipcRenderer.invoke(IPC_CHANNELS.onboardingGet);
  },
  updateOnboardingState(partial?: Partial<OnboardingState>): Promise<OnboardingState> {
    return ipcRenderer.invoke(IPC_CHANNELS.onboardingUpdate, partial);
  },
  completeOnboarding(partial?: Partial<OnboardingState>): Promise<OnboardingState> {
    return ipcRenderer.invoke(IPC_CHANNELS.onboardingComplete, partial);
  },
  resetOnboarding(): Promise<OnboardingState> {
    return ipcRenderer.invoke(IPC_CHANNELS.onboardingReset);
  },
  getOnboardingVerificationState(): Promise<OnboardingVerificationState> {
    return ipcRenderer.invoke(IPC_CHANNELS.onboardingVerificationGet);
  },
  armOnboardingVerification(): Promise<OnboardingVerificationState> {
    return ipcRenderer.invoke(IPC_CHANNELS.onboardingVerificationArm);
  },
  resetOnboardingVerification(): Promise<OnboardingVerificationState> {
    return ipcRenderer.invoke(IPC_CHANNELS.onboardingVerificationReset);
  },
  openSettings(mode?: SettingsWindowMode): Promise<boolean> {
    return ipcRenderer.invoke(IPC_CHANNELS.settingsOpen, mode);
  },
  listModels(): Promise<ModelListItem[]> {
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
  requestMicrophonePermission(): Promise<boolean> {
    return ipcRenderer.invoke(IPC_CHANNELS.permissionsRequestMicrophone);
  },
  openPrivacySettings(pane?: PrivacyPane): Promise<boolean> {
    return ipcRenderer.invoke(IPC_CHANNELS.permissionsOpenPrivacy, pane);
  },
  checkPermissions(): Promise<PermissionsSnapshot> {
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
  onOnboardingVerificationChanged(callback: (state: OnboardingVerificationState) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: OnboardingVerificationState) => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.onboardingVerificationChanged, listener);
    return () => {
      ipcRenderer.off(IPC_CHANNELS.onboardingVerificationChanged, listener);
    };
  },
  onUpdateStateChanged(callback: (status: UpdateStatus) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: UpdateStatus) => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.updatesStateChanged, listener);
    return () => {
      ipcRenderer.off(IPC_CHANNELS.updatesStateChanged, listener);
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
  onModelDownloadProgress(callback: (payload: ModelDownloadProgressPayload) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: ModelDownloadProgressPayload) => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.modelDownloadProgress, listener);
    return () => {
      ipcRenderer.off(IPC_CHANNELS.modelDownloadProgress, listener);
    };
  }
};

contextBridge.exposeInMainWorld("voicebar", api);
