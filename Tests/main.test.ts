import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/shared/types";

type ElectronAppMock = {
  on: ReturnType<typeof vi.fn>;
  whenReady: ReturnType<typeof vi.fn>;
  quit: ReturnType<typeof vi.fn>;
};

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("main process startup", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.VITE_DEV_SERVER_URL;
  });

  it("opens settings when startup reports a recoverable issue and reopens on activate", async () => {
    const appEvents = new Map<string, () => void>();
    let resolveReady: (() => void) | undefined;

    const app: ElectronAppMock = {
      on: vi.fn((event: string, callback: () => void) => {
        appEvents.set(event, callback);
      }),
      whenReady: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveReady = resolve;
          })
      ),
      quit: vi.fn()
    };
    const dialog = { showErrorBox: vi.fn() };
    const settingsWindow = { show: vi.fn(), get: vi.fn(() => undefined) };
    const overlayWindow = { create: vi.fn() };
    const tray = { setUpdateMenuState: vi.fn(), update: vi.fn() };
    const settingsStore = {
      load: vi.fn(() => DEFAULT_SETTINGS),
      loadOnboarding: vi.fn(() => ({ completed: true, version: 1 })),
      resolveSettingsWindowMode: vi.fn((mode?: string) => mode ?? "settings"),
      shouldOpenWindowOnLaunch: vi.fn(() => true),
      markPostOnboardingWindowSeen: vi.fn()
    };
    const appState = {
      on: vi.fn(),
      getSnapshot: vi.fn(() => ({ mode: "idle", settings: DEFAULT_SETTINGS }))
    };
    const coordinator = { start: vi.fn(() => "Hotkey is unavailable. Choose a different shortcut."), stop: vi.fn() };
    const updateService = {
      start: vi.fn(),
      stop: vi.fn(),
      setEnabled: vi.fn(),
      checkForUpdatesManual: vi.fn(),
      installDownloadedUpdate: vi.fn(),
      onMenuStateChanged: vi.fn(() => vi.fn())
    };
    const whisperService = { getDiagnostics: vi.fn(async () => undefined) };

    vi.doMock("electron", () => ({ app, dialog }));
    vi.doMock("../src/main/state/appState", () => ({ AppState: vi.fn(() => appState) }));
    vi.doMock("../src/main/services/settingsStore", () => ({ SettingsStore: vi.fn(() => settingsStore) }));
    vi.doMock("../src/main/services/hotkeyService", () => ({ HotkeyService: vi.fn(() => ({})) }));
    vi.doMock("../src/main/services/audioCaptureService", () => ({ AudioCaptureService: vi.fn(() => ({})) }));
    vi.doMock("../src/main/services/whisperService", () => ({ WhisperService: vi.fn(() => whisperService) }));
    vi.doMock("../src/main/services/modelManager", () => ({ ModelManager: vi.fn(() => ({ ensureBundledModel: vi.fn(async () => true) })) }));
    vi.doMock("../src/main/services/pasteService", () => ({ PasteService: vi.fn(() => ({})) }));
    vi.doMock("../src/main/services/permissionService", () => ({ PermissionService: vi.fn(() => ({})) }));
    vi.doMock("../src/main/services/updateService", () => ({ UpdateService: vi.fn(() => updateService) }));
    vi.doMock("../src/main/windows/settingsWindow", () => ({ SettingsWindow: vi.fn(() => settingsWindow) }));
    vi.doMock("../src/main/windows/overlayWindow", () => ({ OverlayWindow: vi.fn(() => overlayWindow) }));
    vi.doMock("../src/main/tray", () => ({ TrayController: vi.fn(() => tray) }));
    vi.doMock("../src/main/coordinator", () => ({ AppCoordinator: vi.fn(() => coordinator) }));
    vi.doMock("../src/main/ipc/handlers", () => ({ registerIpcHandlers: vi.fn() }));

    await import("../src/main/main");
    resolveReady?.();
    await flushMicrotasks();

    expect(settingsWindow.show).toHaveBeenCalledWith(expect.stringContaining("preload.js"), undefined, "settings");
    expect(dialog.showErrorBox).not.toHaveBeenCalled();

    const activate = appEvents.get("activate");
    expect(activate).toBeTypeOf("function");
    activate?.();

    expect(settingsWindow.show).toHaveBeenCalledTimes(2);
  });

  it("shows a startup error dialog when bootstrap throws", async () => {
    let resolveReady: (() => void) | undefined;
    const app = {
      on: vi.fn(),
      whenReady: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveReady = resolve;
          })
      ),
      quit: vi.fn()
    };
    const dialog = { showErrorBox: vi.fn() };

    vi.doMock("electron", () => ({ app, dialog }));
    vi.doMock("../src/main/services/settingsStore", () => ({
      SettingsStore: vi.fn(() => ({
        load: vi.fn(() => {
          throw new Error("settings exploded");
        })
      }))
    }));
    vi.doMock("../src/main/coordinator", () => ({ AppCoordinator: vi.fn() }));
    vi.doMock("../src/main/state/appState", () => ({ AppState: vi.fn() }));
    vi.doMock("../src/main/services/hotkeyService", () => ({ HotkeyService: vi.fn() }));
    vi.doMock("../src/main/services/audioCaptureService", () => ({ AudioCaptureService: vi.fn() }));
    vi.doMock("../src/main/services/whisperService", () => ({ WhisperService: vi.fn(() => ({ getDiagnostics: vi.fn() })) }));
    vi.doMock("../src/main/services/modelManager", () => ({ ModelManager: vi.fn(() => ({ ensureBundledModel: vi.fn(async () => true) })) }));
    vi.doMock("../src/main/services/pasteService", () => ({ PasteService: vi.fn() }));
    vi.doMock("../src/main/services/permissionService", () => ({ PermissionService: vi.fn() }));
    vi.doMock("../src/main/services/updateService", () => ({ UpdateService: vi.fn() }));
    vi.doMock("../src/main/windows/settingsWindow", () => ({ SettingsWindow: vi.fn(() => ({ show: vi.fn(), get: vi.fn() })) }));
    vi.doMock("../src/main/windows/overlayWindow", () => ({ OverlayWindow: vi.fn() }));
    vi.doMock("../src/main/tray", () => ({ TrayController: vi.fn() }));
    vi.doMock("../src/main/ipc/handlers", () => ({ registerIpcHandlers: vi.fn() }));

    await import("../src/main/main");
    resolveReady?.();
    await flushMicrotasks();

    expect(dialog.showErrorBox).toHaveBeenCalledWith("Vorn Voice could not start", "settings exploded");
  });
});
