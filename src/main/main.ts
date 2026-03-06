import { app, dialog } from "electron";
import path from "node:path";
import { AppCoordinator } from "./coordinator";
import { registerIpcHandlers } from "./ipc/handlers";
import { AudioCaptureService } from "./services/audioCaptureService";
import { HotkeyService } from "./services/hotkeyService";
import { ModelManager } from "./services/modelManager";
import { PasteService } from "./services/pasteService";
import { PermissionService } from "./services/permissionService";
import { SettingsStore } from "./services/settingsStore";
import { UpdateService } from "./services/updateService";
import { WhisperService } from "./services/whisperService";
import { AppState } from "./state/appState";
import { TrayController } from "./tray";
import { OverlayWindow } from "./windows/overlayWindow";
import { SettingsWindow } from "./windows/settingsWindow";
import { ONBOARDING_VERSION } from "../shared/types";

let coordinator: AppCoordinator | undefined;
let updateService: UpdateService | undefined;
let unsubscribeUpdateState: (() => void) | undefined;
let settingsWindow: SettingsWindow | undefined;
let startupContext: { preloadPath: string; rendererURL?: string } | undefined;

async function bootstrap(): Promise<void> {
  const preloadPath = path.join(__dirname, "../preload/preload.js");
  const rendererURL = process.env.VITE_DEV_SERVER_URL;
  startupContext = { preloadPath, rendererURL };

  const settingsStore = new SettingsStore();
  const settings = settingsStore.load();

  const appState = new AppState(settings);
  const hotkeyService = new HotkeyService();
  const audioCaptureService = new AudioCaptureService();
  const whisperService = new WhisperService();
  updateService = new UpdateService(process.env.VORN_UPDATE_FEED_URL);
  const updater = updateService;
  const modelManager = new ModelManager();
  const pasteService = new PasteService();
  const permissionService = new PermissionService();
  settingsWindow = new SettingsWindow();
  const settingsUi = settingsWindow;
  const overlayWindow = new OverlayWindow();

  overlayWindow.create(preloadPath, rendererURL);

  coordinator = new AppCoordinator(
    appState,
    settingsStore,
    hotkeyService,
    audioCaptureService,
    whisperService,
    modelManager,
    pasteService,
    permissionService,
    overlayWindow
  );

  registerIpcHandlers({
    appState,
    coordinator,
    hotkeyService,
    modelManager,
    permissionService,
    whisperService,
    settingsStore,
    settingsWindow: settingsUi,
    preloadPath,
    rendererURL
  });

  void whisperService.getDiagnostics().catch(() => undefined);

  const tray = new TrayController(
    () => {
      settingsUi.show(preloadPath, rendererURL, "settings");
    },
    () => {
      app.quit();
    },
    () => {
      void updater.checkForUpdatesManual();
    },
    () => {
      updater.installDownloadedUpdate();
    }
  );

  updater.start(settings.autoUpdateEnabled);
  unsubscribeUpdateState = updater.onMenuStateChanged((menuState) => {
    tray.setUpdateMenuState(menuState);
  });

  appState.on("changed", (snapshot) => {
    tray.update(snapshot);
    updater.setEnabled(snapshot.settings.autoUpdateEnabled);
  });
  tray.update(appState.getSnapshot());

  const onboarding = settingsStore.loadOnboarding();
  const shouldShowOnboarding = !onboarding.completed || onboarding.version < ONBOARDING_VERSION;
  const startupIssue = coordinator.start();
  const initialMode = shouldShowOnboarding ? "onboarding" : "settings";

  if (shouldShowOnboarding || startupIssue) {
    settingsUi.show(preloadPath, rendererURL, initialMode);
  }
}

app.on("window-all-closed", () => {
  // Keep running as a menu bar app.
});

app.on("before-quit", () => {
  coordinator?.stop();
  updateService?.stop();
  unsubscribeUpdateState?.();
});

app.on("activate", () => {
  if (!settingsWindow || !startupContext) {
    return;
  }

  settingsWindow.show(startupContext.preloadPath, startupContext.rendererURL, "settings");
});

app.whenReady().then(async () => {
  try {
    await bootstrap();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown startup failure";
    console.error("Failed to start Vorn Voice", error);
    dialog.showErrorBox("Vorn Voice could not start", message);

    if (settingsWindow && startupContext) {
      settingsWindow.show(startupContext.preloadPath, startupContext.rendererURL, "settings");
    }
  }
});
