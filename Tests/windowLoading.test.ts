import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type MockWindow = {
  isDestroyed: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
  hide: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  loadURL: ReturnType<typeof vi.fn>;
  loadFile: ReturnType<typeof vi.fn>;
  setVisibleOnAllWorkspaces: ReturnType<typeof vi.fn>;
  setIgnoreMouseEvents: ReturnType<typeof vi.fn>;
  showInactive: ReturnType<typeof vi.fn>;
  getBounds: ReturnType<typeof vi.fn>;
  setPosition: ReturnType<typeof vi.fn>;
  webContents: {
    on: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  };
};

const createdWindows: MockWindow[] = [];

vi.mock("electron", () => {
  return {
    BrowserWindow: vi.fn((options: unknown) => {
      const window: MockWindow = {
        isDestroyed: vi.fn(() => false),
        show: vi.fn(),
        hide: vi.fn(),
        focus: vi.fn(),
        on: vi.fn(),
        loadURL: vi.fn().mockResolvedValue(undefined),
        loadFile: vi.fn().mockResolvedValue(undefined),
        setVisibleOnAllWorkspaces: vi.fn(),
        setIgnoreMouseEvents: vi.fn(),
        showInactive: vi.fn(),
        getBounds: vi.fn(() => ({ width: 320, height: 92 })),
        setPosition: vi.fn(),
        webContents: {
          on: vi.fn(),
          send: vi.fn()
        }
      };

      createdWindows.push(window);
      (window as MockWindow & { options: unknown }).options = options;

      return window;
    }),
    screen: {
      getDisplayNearestPoint: vi.fn(),
      getCursorScreenPoint: vi.fn()
    }
  };
});

describe("window loaders", () => {
  beforeEach(() => {
    createdWindows.length = 0;
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("opens settings window with preload sandbox disabled", async () => {
    const { SettingsWindow } = await import("../src/main/windows/settingsWindow");
    const { BrowserWindow } = await import("electron");

    const settingsWindow = new SettingsWindow();
    settingsWindow.show("/tmp/preload.js", "http://127.0.0.1:5173");

    expect(BrowserWindow).toHaveBeenCalledTimes(1);
    const [options] = vi.mocked(BrowserWindow).mock.calls[0] as [{ webPreferences: { sandbox: boolean } }];
    expect(options.webPreferences.sandbox).toBe(false);
    expect(createdWindows[0].loadURL).toHaveBeenCalledWith("http://127.0.0.1:5173/settings/index.html?mode=settings");
  });

  it("loads settings html file in production mode", async () => {
    const { SettingsWindow } = await import("../src/main/windows/settingsWindow");

    const settingsWindow = new SettingsWindow();
    settingsWindow.show("/tmp/preload.js");

    expect(createdWindows[0].loadFile).toHaveBeenCalledWith(
      expect.stringContaining(path.join("renderer", "settings", "index.html")),
      { query: { mode: "settings" } }
    );
  });

  it("opens overlay window with preload sandbox disabled", async () => {
    const { OverlayWindow } = await import("../src/main/windows/overlayWindow");
    const { BrowserWindow } = await import("electron");

    const overlayWindow = new OverlayWindow();
    overlayWindow.create("/tmp/preload.js", "http://127.0.0.1:5173");

    expect(BrowserWindow).toHaveBeenCalledTimes(1);
    const [options] = vi.mocked(BrowserWindow).mock.calls[0] as [{ webPreferences: { sandbox: boolean } }];
    expect(options.webPreferences.sandbox).toBe(false);
    expect(createdWindows[0].loadURL).toHaveBeenCalledWith("http://127.0.0.1:5173/overlay/index.html");
  });

  it("cancels stale delayed hides when a new overlay is shown", async () => {
    vi.useFakeTimers();
    const { OverlayWindow } = await import("../src/main/windows/overlayWindow");
    const { screen } = await import("electron");

    vi.mocked(screen.getCursorScreenPoint).mockReturnValue({ x: 0, y: 0 } as any);
    vi.mocked(screen.getDisplayNearestPoint).mockReturnValue({
      workArea: { width: 1440, height: 900, x: 0, y: 0 }
    } as any);

    const overlayWindow = new OverlayWindow();
    overlayWindow.create("/tmp/preload.js");

    overlayWindow.hide(1000);
    overlayWindow.show("listening", "Listening...");
    vi.advanceTimersByTime(1000);

    expect(createdWindows[0].hide).not.toHaveBeenCalled();
    expect(createdWindows[0].showInactive).toHaveBeenCalled();
  });

  it("clears a pending delayed hide when hide is called immediately", async () => {
    vi.useFakeTimers();
    const { OverlayWindow } = await import("../src/main/windows/overlayWindow");

    const overlayWindow = new OverlayWindow();
    overlayWindow.create("/tmp/preload.js");

    overlayWindow.hide(1000);
    overlayWindow.hide(0);
    vi.advanceTimersByTime(1000);

    expect(createdWindows[0].hide).toHaveBeenCalledTimes(1);
  });
});
