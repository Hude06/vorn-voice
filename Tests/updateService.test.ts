import { beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateService } from "../src/main/services/updateService";

const listeners = new Map<string, (...args: unknown[]) => void>();

vi.mock("electron", () => ({
  app: {
    isPackaged: true
  }
}));

vi.mock("electron-updater", () => ({
  autoUpdater: {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    setFeedURL: vi.fn(),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, listener);
    }),
    checkForUpdates: vi.fn(async () => {
      listeners.get("error")?.(new Error("network down"));
    }),
    quitAndInstall: vi.fn()
  }
}));

describe("UpdateService menu messaging", () => {
  beforeEach(() => {
    listeners.clear();
    vi.clearAllMocks();
  });

  it("shows non-error wording for automatic check failures", () => {
    const service = new UpdateService("https://updates.example.com/feed");
    let latestLabel = "";

    service.onMenuStateChanged((state) => {
      latestLabel = state.label;
    });
    service.start(true);

    listeners.get("error")?.(new Error("network down"));

    expect(latestLabel).toBe("Automatic update check unavailable");
  });

  it("keeps manual check failures actionable", async () => {
    const service = new UpdateService("https://updates.example.com/feed");
    let latestLabel = "";

    service.onMenuStateChanged((state) => {
      latestLabel = state.label;
    });
    service.start(true);

    await service.checkForUpdatesManual();

    expect(latestLabel).toBe("Could not check for updates: network down");
  });
});
