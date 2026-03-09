import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ONBOARDING_STATE, DEFAULT_SETTINGS, ONBOARDING_VERSION } from "../src/shared/types";

const fileState = {
  raw: ""
};

const readFileSyncMock = vi.fn(() => {
  if (!fileState.raw) {
    throw new Error("ENOENT");
  }

  return fileState.raw;
});
const writeFileSyncMock = vi.fn((_path: string, value: string) => {
  fileState.raw = value;
});
const mkdirSyncMock = vi.fn();

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp/vorn-tests")
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
});
