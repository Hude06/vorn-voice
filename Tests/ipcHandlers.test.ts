import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/shared/types";
import { IPC_CHANNELS } from "../src/main/ipc/channels";

const handleMock = vi.fn();

vi.mock("electron", () => ({
  app: {
    getVersion: vi.fn(() => "1.0.0")
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [])
  },
  ipcMain: {
    handle: handleMock
  }
}));

describe("registerIpcHandlers settings sanitization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("sanitizes malformed settings before update", async () => {
    const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>();
    handleMock.mockImplementation((channel: string, handler: (...args: unknown[]) => unknown) => {
      registeredHandlers.set(channel, handler);
    });

    const deps = {
      appState: {
        getSnapshot: vi.fn(() => ({ ok: true })),
        on: vi.fn()
      },
      coordinator: {
        updateSettings: vi.fn()
      },
      hotkeyService: {
        beginCapture: vi.fn(),
        cancelCapture: vi.fn(),
        probeHook: vi.fn(() => undefined)
      },
      modelManager: {
        catalog: [],
        isInstalled: vi.fn(),
        downloadModel: vi.fn(),
        removeModel: vi.fn()
      },
      permissionService: {
        openPrivacySettings: vi.fn(),
        requestMicrophonePermission: vi.fn(),
        checkAccessibilityPermission: vi.fn(() => true),
        getMicrophonePermissionStatus: vi.fn(() => "granted")
      },
      whisperService: {
        getDiagnostics: vi.fn(),
        installRuntime: vi.fn()
      },
      updater: {
        getMenuState: vi.fn(() => ({ updateState: "idle" })),
        checkForUpdatesManual: vi.fn(),
        installDownloadedUpdate: vi.fn(),
        onMenuStateChanged: vi.fn()
      },
      settingsStore: {
        resolveSettingsWindowMode: vi.fn((mode?: string) => mode ?? "settings"),
        loadOnboarding: vi.fn(),
        completeOnboarding: vi.fn(),
        resetOnboarding: vi.fn()
      },
      settingsWindow: {
        show: vi.fn()
      },
      preloadPath: "/tmp/preload.js",
      rendererURL: "http://localhost:5173"
    };

    const { registerIpcHandlers } = await import("../src/main/ipc/handlers");
    registerIpcHandlers(deps as never);

    const handler = registeredHandlers.get(IPC_CHANNELS.settingsSave);
    expect(handler).toBeTypeOf("function");

    handler?.({}, {
      ...DEFAULT_SETTINGS,
      preRollMs: Number.NaN,
      postRollMs: 9_999,
      autoPaste: "yes",
      lowLatencyCaptureEnabled: "no",
      shortcut: {
        keyCode: 49,
        modifiers: ["cmd", "nope"],
        display: "Cmd+Space"
      }
    });

    expect(deps.coordinator.updateSettings).toHaveBeenCalledWith(expect.objectContaining({
      preRollMs: DEFAULT_SETTINGS.preRollMs,
      postRollMs: 1200,
      autoPaste: DEFAULT_SETTINGS.autoPaste,
      lowLatencyCaptureEnabled: DEFAULT_SETTINGS.lowLatencyCaptureEnabled,
      shortcut: {
        keyCode: 49,
        modifiers: ["cmd"],
        display: "Cmd+Space"
      }
    }));
  });
});
