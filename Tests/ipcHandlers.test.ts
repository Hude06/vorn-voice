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
        updateSettings: vi.fn(),
        getOnboardingVerificationState: vi.fn(() => ({ status: "idle", shortcut: DEFAULT_SETTINGS.shortcut })),
        armOnboardingVerification: vi.fn(() => ({ status: "armed", shortcut: DEFAULT_SETTINGS.shortcut })),
        resetOnboardingVerification: vi.fn(() => ({ status: "idle", shortcut: DEFAULT_SETTINGS.shortcut })),
        onOnboardingVerificationChanged: vi.fn(() => () => undefined)
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
        updateOnboarding: vi.fn(() => ({ completed: false, version: 1, dictationVerified: true })),
        completeOnboarding: vi.fn(),
        resetOnboarding: vi.fn()
      },
      speechStatsStore: {
        load: vi.fn(() => ({ totalWords: 120, totalDurationMs: 60000, sampleCount: 3, lastSampleId: "sample-3", lastSampleWpm: 125, dailyWordBuckets: {} }))
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

  it("registers onboarding verification and onboarding update handlers", async () => {
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
        updateSettings: vi.fn(),
        getOnboardingVerificationState: vi.fn(() => ({ status: "idle", shortcut: DEFAULT_SETTINGS.shortcut })),
        armOnboardingVerification: vi.fn(() => ({ status: "armed", shortcut: DEFAULT_SETTINGS.shortcut })),
        resetOnboardingVerification: vi.fn(() => ({ status: "idle", shortcut: DEFAULT_SETTINGS.shortcut })),
        onOnboardingVerificationChanged: vi.fn(() => () => undefined)
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
        updateOnboarding: vi.fn(() => ({ completed: false, version: 1, dictationVerified: true })),
        completeOnboarding: vi.fn(),
        resetOnboarding: vi.fn()
      },
      speechStatsStore: {
        load: vi.fn(() => ({ totalWords: 120, totalDurationMs: 60000, sampleCount: 3, lastSampleId: "sample-3", lastSampleWpm: 125, dailyWordBuckets: {} }))
      },
      settingsWindow: {
        show: vi.fn()
      },
      preloadPath: "/tmp/preload.js",
      rendererURL: "http://localhost:5173"
    };

    const { registerIpcHandlers } = await import("../src/main/ipc/handlers");
    registerIpcHandlers(deps as never);

    await registeredHandlers.get(IPC_CHANNELS.onboardingUpdate)?.({}, { dictationVerified: true });
    await registeredHandlers.get(IPC_CHANNELS.onboardingVerificationGet)?.({});
    await registeredHandlers.get(IPC_CHANNELS.onboardingVerificationArm)?.({});
    await registeredHandlers.get(IPC_CHANNELS.onboardingVerificationReset)?.({});

    expect(deps.settingsStore.updateOnboarding).toHaveBeenCalledWith({ dictationVerified: true });
    expect(deps.coordinator.getOnboardingVerificationState).toHaveBeenCalled();
    expect(deps.coordinator.armOnboardingVerification).toHaveBeenCalled();
    expect(deps.coordinator.resetOnboardingVerification).toHaveBeenCalled();
    expect(deps.coordinator.onOnboardingVerificationChanged).toHaveBeenCalled();
  });

  it("registers speech stats handler", async () => {
    const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>();
    handleMock.mockImplementation((channel: string, handler: (...args: unknown[]) => unknown) => {
      registeredHandlers.set(channel, handler);
    });

    const stats = { totalWords: 480, totalDurationMs: 120000, sampleCount: 8, lastSampleId: "sample-8", lastSampleWpm: 140, dailyWordBuckets: { "2026-03-10": 80 } };
    const deps = {
      appState: {
        getSnapshot: vi.fn(() => ({ ok: true })),
        on: vi.fn()
      },
      coordinator: {
        updateSettings: vi.fn(),
        getOnboardingVerificationState: vi.fn(() => ({ status: "idle", shortcut: DEFAULT_SETTINGS.shortcut })),
        armOnboardingVerification: vi.fn(() => ({ status: "armed", shortcut: DEFAULT_SETTINGS.shortcut })),
        resetOnboardingVerification: vi.fn(() => ({ status: "idle", shortcut: DEFAULT_SETTINGS.shortcut })),
        onOnboardingVerificationChanged: vi.fn(() => () => undefined)
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
        updateOnboarding: vi.fn(),
        completeOnboarding: vi.fn(),
        resetOnboarding: vi.fn()
      },
      speechStatsStore: {
        load: vi.fn(() => stats)
      },
      settingsWindow: {
        show: vi.fn()
      },
      preloadPath: "/tmp/preload.js",
      rendererURL: "http://localhost:5173"
    };

    const { registerIpcHandlers } = await import("../src/main/ipc/handlers");
    registerIpcHandlers(deps as never);

    expect(registeredHandlers.get(IPC_CHANNELS.speechStatsGet)?.({})).toEqual(stats);
    expect(deps.speechStatsStore.load).toHaveBeenCalled();
  });
});
