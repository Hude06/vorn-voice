export const IPC_CHANNELS = {
  stateGet: "state:get",
  stateChanged: "state:changed",
  appVersionGet: "app-version:get",
  settingsSave: "settings:save",
  settingsOpen: "settings:open",
  updatesGetState: "updates:get-state",
  updatesStateChanged: "updates:state-changed",
  updatesCheckManual: "updates:check-manual",
  updatesInstall: "updates:install",
  onboardingGet: "onboarding:get",
  onboardingComplete: "onboarding:complete",
  onboardingReset: "onboarding:reset",
  modelsList: "models:list",
  modelDownload: "model:download",
  modelDownloadProgress: "model:download-progress",
  modelRemove: "model:remove",
  hotkeyCaptureStart: "hotkey:capture-start",
  hotkeyCaptureCancel: "hotkey:capture-cancel",
  hotkeyCaptured: "hotkey:captured",
  speechRuntimeDiagnostics: "speech-runtime:diagnostics",
  speechRuntimeInstall: "speech-runtime:install",
  permissionsOpenPrivacy: "permissions:open-privacy",
  permissionsRequestMicrophone: "permissions:request-microphone",
  permissionsCheck: "permissions:check",
  overlayUpdate: "overlay:update"
} as const;

export type IpcChannelName = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
