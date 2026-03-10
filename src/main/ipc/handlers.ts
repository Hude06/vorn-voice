import { app, BrowserWindow, WebContents, ipcMain } from "electron";
import { AppCoordinator } from "../coordinator";
import { HotkeyService } from "../services/hotkeyService";
import { ModelManager } from "../services/modelManager";
import { PermissionService } from "../services/permissionService";
import { SettingsStore } from "../services/settingsStore";
import { SpeechStatsStore } from "../services/speechStatsStore";
import { UpdateService } from "../services/updateService";
import { WhisperService } from "../services/whisperService";
import { AppState } from "../state/appState";
import { SettingsWindow } from "../windows/settingsWindow";
import { IPC_CHANNELS } from "./channels";
import { AppSettings, DEFAULT_SETTINGS, OnboardingState, PrivacyPane, SettingsWindowMode } from "../../shared/types";

type HandlerDeps = {
  appState: AppState;
  coordinator: AppCoordinator;
  hotkeyService: HotkeyService;
  modelManager: ModelManager;
  permissionService: PermissionService;
  whisperService: WhisperService;
  updater: UpdateService;
  settingsStore: SettingsStore;
  speechStatsStore: SpeechStatsStore;
  settingsWindow: SettingsWindow;
  preloadPath: string;
  rendererURL?: string;
};

export function registerIpcHandlers(deps: HandlerDeps): void {
  ipcMain.handle(IPC_CHANNELS.stateGet, () => deps.appState.getSnapshot());
  ipcMain.handle(IPC_CHANNELS.speechStatsGet, () => deps.speechStatsStore.load());
  ipcMain.handle(IPC_CHANNELS.appVersionGet, () => app.getVersion());

  ipcMain.handle(IPC_CHANNELS.settingsSave, (_event, settings: AppSettings) => {
    deps.coordinator.updateSettings(sanitizeSettings(settings));
    return deps.appState.getSnapshot();
  });

  ipcMain.handle(IPC_CHANNELS.updatesGetState, () => deps.updater.getMenuState());

  ipcMain.handle(IPC_CHANNELS.updatesCheckManual, async () => {
    await deps.updater.checkForUpdatesManual();
    return deps.updater.getMenuState();
  });

  ipcMain.handle(IPC_CHANNELS.updatesInstall, () => deps.updater.installDownloadedUpdate());

  ipcMain.handle(IPC_CHANNELS.settingsOpen, (_event, mode?: SettingsWindowMode) => {
    deps.settingsWindow.show(
      deps.preloadPath,
      deps.rendererURL,
      deps.settingsStore.resolveSettingsWindowMode(mode)
    );
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.onboardingGet, () => deps.settingsStore.loadOnboarding());

  ipcMain.handle(IPC_CHANNELS.onboardingUpdate, (_event, partial?: Partial<OnboardingState>) =>
    deps.settingsStore.updateOnboarding(partial)
  );

  ipcMain.handle(IPC_CHANNELS.onboardingComplete, (_event, partial?: Partial<OnboardingState>) =>
    deps.settingsStore.completeOnboarding(partial)
  );

  ipcMain.handle(IPC_CHANNELS.onboardingReset, () => deps.settingsStore.resetOnboarding());

  ipcMain.handle(IPC_CHANNELS.onboardingVerificationGet, () => deps.coordinator.getOnboardingVerificationState());

  ipcMain.handle(IPC_CHANNELS.onboardingVerificationArm, () => deps.coordinator.armOnboardingVerification());

  ipcMain.handle(IPC_CHANNELS.onboardingVerificationReset, () => deps.coordinator.resetOnboardingVerification());

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

  ipcMain.handle(IPC_CHANNELS.permissionsOpenPrivacy, (_event, pane?: PrivacyPane) => {
    deps.permissionService.openPrivacySettings(pane);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.permissionsRequestMicrophone, () => deps.permissionService.requestMicrophonePermission());

  ipcMain.handle(IPC_CHANNELS.permissionsCheck, () => {
    const hotkeyMessage = deps.hotkeyService.probeHook();

    return {
      accessibility: deps.permissionService.checkAccessibilityPermission(false),
      microphone: deps.permissionService.getMicrophonePermissionStatus(),
      hotkeyReady: !hotkeyMessage,
      hotkeyMessage
    };
  });

  ipcMain.handle(IPC_CHANNELS.speechRuntimeDiagnostics, async () => deps.whisperService.getDiagnostics());

  ipcMain.handle(IPC_CHANNELS.speechRuntimeInstall, async () => deps.whisperService.installRuntime());

  deps.appState.on("changed", (snapshot) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      safeSend(window.webContents, IPC_CHANNELS.stateChanged, snapshot);
    });
  });

  deps.coordinator.onOnboardingVerificationChanged((verificationState) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      safeSend(window.webContents, IPC_CHANNELS.onboardingVerificationChanged, verificationState);
    });
  });

  deps.updater.onMenuStateChanged((menuState) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      safeSend(window.webContents, IPC_CHANNELS.updatesStateChanged, menuState);
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

function sanitizeSettings(settings: AppSettings): AppSettings {
  const candidate = asRecord(settings);
  const shortcutCandidate = asRecord(candidate.shortcut);
  const keyCode = clampCaptureWindow(
    typeof shortcutCandidate.keyCode === "number" ? shortcutCandidate.keyCode : DEFAULT_SETTINGS.shortcut.keyCode,
    1,
    9999,
    DEFAULT_SETTINGS.shortcut.keyCode
  );
  const modifiers = Array.isArray(shortcutCandidate.modifiers)
    ? shortcutCandidate.modifiers.filter((modifier): modifier is "cmd" | "shift" | "alt" | "ctrl" =>
      modifier === "cmd" || modifier === "shift" || modifier === "alt" || modifier === "ctrl"
    )
    : DEFAULT_SETTINGS.shortcut.modifiers;
  const shortcut = {
    keyCode,
    modifiers,
    display: typeof shortcutCandidate.display === "string"
      ? shortcutCandidate.display
      : DEFAULT_SETTINGS.shortcut.display
  };

  const hotkeyBehavior = candidate.hotkeyBehavior === "toggle" || candidate.hotkeyBehavior === "hold"
    ? candidate.hotkeyBehavior
    : DEFAULT_SETTINGS.hotkeyBehavior;
  const speechCleanupMode = candidate.speechCleanupMode === "off"
    || candidate.speechCleanupMode === "balanced"
    || candidate.speechCleanupMode === "aggressive"
    ? candidate.speechCleanupMode
    : DEFAULT_SETTINGS.speechCleanupMode;

  return {
    ...DEFAULT_SETTINGS,
    shortcut,
    hotkeyBehavior,
    activeModelId: typeof candidate.activeModelId === "string" && candidate.activeModelId.trim().length > 0
      ? candidate.activeModelId
      : DEFAULT_SETTINGS.activeModelId,
    speechCleanupMode,
    lowLatencyCaptureEnabled: booleanOrDefault(candidate.lowLatencyCaptureEnabled, DEFAULT_SETTINGS.lowLatencyCaptureEnabled),
    preRollMs: clampCaptureWindow(
      typeof candidate.preRollMs === "number" ? candidate.preRollMs : DEFAULT_SETTINGS.preRollMs,
      0,
      1200,
      DEFAULT_SETTINGS.preRollMs
    ),
    postRollMs: clampCaptureWindow(
      typeof candidate.postRollMs === "number" ? candidate.postRollMs : DEFAULT_SETTINGS.postRollMs,
      0,
      1200,
      DEFAULT_SETTINGS.postRollMs
    ),
    autoPaste: booleanOrDefault(candidate.autoPaste, DEFAULT_SETTINGS.autoPaste),
    restoreClipboard: booleanOrDefault(candidate.restoreClipboard, DEFAULT_SETTINGS.restoreClipboard),
    autoUpdateEnabled: booleanOrDefault(candidate.autoUpdateEnabled, DEFAULT_SETTINGS.autoUpdateEnabled)
  };
}

function clampCaptureWindow(value: number, minimum: number, maximum: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return {};
  }

  return value as Record<string, unknown>;
}
