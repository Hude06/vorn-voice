import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ONBOARDING_STATE, DEFAULT_SETTINGS, ONBOARDING_VERSION } from "../src/shared/types";

const fileState = {
  raw: ""
};

const readFileSyncMock = vi.fn(() => {
  if (!fileState.raw) {
    const error = new Error("ENOENT") as Error & { code?: string };
    error.code = "ENOENT";
    throw error;
  }

  return fileState.raw;
});
const writeFileSyncMock = vi.fn((_path: string, value: string) => {
  fileState.raw = value;
});
const mkdirSyncMock = vi.fn();

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === "appData") {
        return "/tmp/app-support";
      }

      return "/tmp/vorn-tests";
    })
  }
}));

vi.mock("node:fs", () => ({
  default: {
    readFileSync: readFileSyncMock,
    writeFileSync: writeFileSyncMock,
    mkdirSync: mkdirSyncMock
  }
}));

describe("SettingsStore launch window persistence", () => {
  beforeEach(() => {
    fileState.raw = "";
    vi.clearAllMocks();
    vi.resetModules();
    readFileSyncMock.mockImplementation(() => {
      if (!fileState.raw) {
        const error = new Error("ENOENT") as Error & { code?: string };
        error.code = "ENOENT";
        throw error;
      }

      return fileState.raw;
    });
  });

  it("respects persisted post-onboarding seen state", async () => {
    fileState.raw = JSON.stringify({
      settings: DEFAULT_SETTINGS,
      onboarding: {
        ...DEFAULT_ONBOARDING_STATE,
        completed: true,
        version: ONBOARDING_VERSION
      },
      ui: {
        hasSeenPostOnboardingWindow: true
      }
    });

    const { SettingsStore } = await import("../src/main/services/settingsStore");
    const store = new SettingsStore();

    expect(store.shouldOpenWindowOnLaunch()).toBe(false);
  });

  it("persists post-onboarding seen state when marked", async () => {
    fileState.raw = JSON.stringify({
      settings: DEFAULT_SETTINGS,
      onboarding: {
        ...DEFAULT_ONBOARDING_STATE,
        completed: true,
        version: ONBOARDING_VERSION
      }
    });

    const { SettingsStore } = await import("../src/main/services/settingsStore");
    const store = new SettingsStore();

    store.markPostOnboardingWindowSeen();
    const persisted = JSON.parse(fileState.raw) as { ui?: { hasSeenPostOnboardingWindow?: boolean } };

    expect(persisted.ui?.hasSeenPostOnboardingWindow).toBe(true);
    expect(store.shouldOpenWindowOnLaunch()).toBe(false);
  });

  it("persists onboarding verification state updates", async () => {
    fileState.raw = JSON.stringify({
      settings: DEFAULT_SETTINGS,
      onboarding: {
        ...DEFAULT_ONBOARDING_STATE,
        version: ONBOARDING_VERSION
      }
    });

    const { SettingsStore } = await import("../src/main/services/settingsStore");
    const store = new SettingsStore();

    const updated = store.updateOnboarding({
      dictationVerified: true,
      dictationVerifiedAt: 123,
      verifiedModelId: "base.en",
      verifiedHotkeyBehavior: DEFAULT_SETTINGS.hotkeyBehavior,
      verifiedShortcut: DEFAULT_SETTINGS.shortcut
    });

    expect(updated.dictationVerified).toBe(true);
    expect(updated.dictationVerifiedAt).toBe(123);
    expect(updated.verifiedModelId).toBe("base.en");
    expect(updated.verifiedHotkeyBehavior).toBe(DEFAULT_SETTINGS.hotkeyBehavior);
    expect(updated.verifiedShortcut).toEqual(DEFAULT_SETTINGS.shortcut);
  });

  it("clears stale verification metadata when verification is reset", async () => {
    fileState.raw = JSON.stringify({
      settings: DEFAULT_SETTINGS,
      onboarding: {
        ...DEFAULT_ONBOARDING_STATE,
        dictationVerified: true,
        dictationVerifiedAt: 123,
        verifiedModelId: "base.en",
        verifiedHotkeyBehavior: DEFAULT_SETTINGS.hotkeyBehavior,
        verifiedShortcut: DEFAULT_SETTINGS.shortcut,
        version: ONBOARDING_VERSION
      }
    });

    const { SettingsStore } = await import("../src/main/services/settingsStore");
    const store = new SettingsStore();

    const updated = store.updateOnboarding({ dictationVerified: false });

    expect(updated.dictationVerified).toBe(false);
    expect(updated.dictationVerifiedAt).toBeUndefined();
    expect(updated.verifiedModelId).toBeUndefined();
    expect(updated.verifiedHotkeyBehavior).toBeUndefined();
    expect(updated.verifiedShortcut).toBeUndefined();
  });

  it("drops stale selected model onboarding metadata", async () => {
    fileState.raw = JSON.stringify({
      settings: DEFAULT_SETTINGS,
      onboarding: {
        ...DEFAULT_ONBOARDING_STATE,
        completed: true,
        dictationVerified: true,
        dictationVerifiedAt: 123,
        verifiedModelId: "base.en",
        verifiedHotkeyBehavior: DEFAULT_SETTINGS.hotkeyBehavior,
        verifiedShortcut: DEFAULT_SETTINGS.shortcut,
        version: ONBOARDING_VERSION,
        selectedModelId: "base.en"
      }
    });

    const { SettingsStore } = await import("../src/main/services/settingsStore");
    const store = new SettingsStore();

    const onboarding = store.loadOnboarding();

    expect("selectedModelId" in onboarding).toBe(false);
    store.updateOnboarding({ dictationVerified: true });
    const persisted = JSON.parse(fileState.raw) as { onboarding: Record<string, unknown> };
    expect(persisted.onboarding.selectedModelId).toBeUndefined();
  });

  it("migrates settings from the legacy voicebar app data path", async () => {
    readFileSyncMock.mockImplementation((filePath: string) => {
      if (filePath === "/tmp/app-support/voicebar/settings.json") {
        return JSON.stringify({
          settings: {
            ...DEFAULT_SETTINGS,
            hotkeyBehavior: "toggle"
          },
          onboarding: {
            ...DEFAULT_ONBOARDING_STATE,
            completed: true,
            version: ONBOARDING_VERSION
          }
        });
      }

      const error = new Error("ENOENT") as Error & { code?: string };
      error.code = "ENOENT";
      throw error;
    });

    const { SettingsStore } = await import("../src/main/services/settingsStore");
    const store = new SettingsStore();

    expect(store.load().hotkeyBehavior).toBe("toggle");
    expect(writeFileSyncMock).toHaveBeenCalledWith(
      "/tmp/vorn-tests/settings.json",
      expect.stringContaining("\"hotkeyBehavior\": \"toggle\""),
      "utf8"
    );
  });

  it("refuses to overwrite unreadable settings storage", async () => {
    readFileSyncMock.mockImplementation(() => "{broken");

    const { SettingsStore } = await import("../src/main/services/settingsStore");
    const store = new SettingsStore();

    expect(store.load()).toEqual(DEFAULT_SETTINGS);
    expect(() => store.save(DEFAULT_SETTINGS)).toThrow("Could not read existing settings safely");
    expect(writeFileSyncMock).not.toHaveBeenCalled();
  });
});
