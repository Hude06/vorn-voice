import { BrowserWindow, WebContents, ipcMain } from "electron";
import { AppCoordinator } from "../coordinator";
import { HotkeyService } from "../services/hotkeyService";
import { ModelManager } from "../services/modelManager";
import { PermissionService } from "../services/permissionService";
import { SettingsStore } from "../services/settingsStore";
import { WhisperService } from "../services/whisperService";
import { AppState } from "../state/appState";
import { SettingsWindow } from "../windows/settingsWindow";
import { IPC_CHANNELS } from "./channels";
import { AppSettings, OnboardingState, SettingsWindowMode } from "../../shared/types";

type HandlerDeps = {
  appState: AppState;
  coordinator: AppCoordinator;
  hotkeyService: HotkeyService;
  modelManager: ModelManager;
  permissionService: PermissionService;
  whisperService: WhisperService;
  settingsStore: SettingsStore;
  settingsWindow: SettingsWindow;
  preloadPath: string;
  rendererURL?: string;
};

export function registerIpcHandlers(deps: HandlerDeps): void {
  ipcMain.handle(IPC_CHANNELS.stateGet, () => deps.appState.getSnapshot());

  ipcMain.handle(IPC_CHANNELS.settingsSave, (_event, settings: AppSettings) => {
    deps.coordinator.updateSettings(settings);
    return deps.appState.getSnapshot();
  });

  ipcMain.handle(IPC_CHANNELS.settingsOpen, (_event, mode?: SettingsWindowMode) => {
    deps.settingsWindow.show(deps.preloadPath, deps.rendererURL, mode ?? "settings");
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.onboardingGet, () => deps.settingsStore.loadOnboarding());

  ipcMain.handle(IPC_CHANNELS.onboardingComplete, (_event, partial?: Partial<OnboardingState>) =>
    deps.settingsStore.completeOnboarding(partial)
  );

  ipcMain.handle(IPC_CHANNELS.onboardingReset, () => deps.settingsStore.resetOnboarding());

  ipcMain.handle(IPC_CHANNELS.hotkeyCaptureStart, () => {
    deps.hotkeyService.beginCapture((shortcut) => {
      BrowserWindow.getAllWindows().forEach((window) => {
        safeSend(window.webContents, IPC_CHANNELS.hotkeyCaptured, shortcut);
      });
    });
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.hotkeyCaptureCancel, () => {
    deps.hotkeyService.cancelCapture();
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.modelsList, async () => {
    const installed = await Promise.all(
      deps.modelManager.catalog.map((model) => deps.modelManager.isInstalled(model.id))
    );

    return deps.modelManager.catalog.map((model, index) => ({
      ...model,
      installed: installed[index]
    }));
  });

  ipcMain.handle(IPC_CHANNELS.modelDownload, async (event, modelId: string) => {
    await deps.modelManager.downloadModel(modelId, (percent) => {
      safeSend(event.sender, IPC_CHANNELS.modelDownloadProgress, { modelId, percent });
    });
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.modelRemove, async (_event, modelId: string) => {
    await deps.modelManager.removeModel(modelId);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.permissionsOpenPrivacy, () => {
    deps.permissionService.openPrivacySettings();
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.permissionsCheck, () => ({
    accessibility: deps.permissionService.checkAccessibilityPermission(false)
  }));

  ipcMain.handle(IPC_CHANNELS.speechRuntimeDiagnostics, async () => deps.whisperService.getDiagnostics());

  ipcMain.handle(IPC_CHANNELS.speechRuntimeInstall, async () => deps.whisperService.installRuntime());

  deps.appState.on("changed", (snapshot) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      safeSend(window.webContents, IPC_CHANNELS.stateChanged, snapshot);
    });
  });
}

function safeSend(webContents: WebContents, channel: string, payload: unknown): void {
  if (webContents.isDestroyed()) {
    return;
  }

  try {
    webContents.send(channel, payload);
  } catch {
    // Ignore sends to torn-down windows.
  }
}
