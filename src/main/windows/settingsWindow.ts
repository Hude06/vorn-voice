import { BrowserWindow } from "electron";
import path from "node:path";
import { SettingsWindowMode } from "../../shared/types";

export class SettingsWindow {
  private window?: BrowserWindow;
  private currentMode: SettingsWindowMode = "settings";
  private lastLoadFailed = false;
  private ready = false;
  private revealOnLoad = false;

  show(preloadPath: string, rendererURL?: string, mode: SettingsWindowMode = "settings"): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) {
      if (this.currentMode !== mode || this.lastLoadFailed) {
        this.revealOnLoad = true;
        this.currentMode = mode;
        this.window.setTitle(titleForMode(mode));
        this.window.hide();
        void this.loadWindow(rendererURL, mode);
      } else if (this.ready) {
        revealWindow(this.window);
      } else {
        this.revealOnLoad = true;
      }

      return this.window;
    }

    this.currentMode = mode;
    this.ready = false;
    this.revealOnLoad = true;

    this.window = new BrowserWindow({
      width: 1280,
      height: 860,
      minWidth: 1100,
      minHeight: 640,
      show: false,
      backgroundColor: "#050505",
      title: titleForMode(mode),
      webPreferences: {
        preload: preloadPath,
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    this.window.on("closed", () => {
      this.ready = false;
      this.revealOnLoad = false;
      this.lastLoadFailed = false;
      this.window = undefined;
    });

    this.window.webContents.on("did-start-loading", () => {
      this.ready = false;
    });

    this.window.webContents.on("did-finish-load", () => {
      if (!this.window || this.window.isDestroyed()) {
        return;
      }

      this.ready = true;
      if (!this.revealOnLoad) {
        return;
      }

      this.revealOnLoad = false;
      revealWindow(this.window);
    });

    void this.loadWindow(rendererURL, mode);

    return this.window;
  }

  get(): BrowserWindow | undefined {
    return this.window;
  }

  private async loadWindow(rendererURL: string | undefined, mode: SettingsWindowMode): Promise<void> {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }

    try {
      await loadSettingsPage(this.window, rendererURL, mode);
      this.lastLoadFailed = false;
    } catch (error) {
      this.lastLoadFailed = true;
      console.error("Failed to load settings window", error);
      await showLoadErrorPage(this.window, "Vorn Voice could not load the settings window. Please wait a moment and open it again.");
    }
  }
}

function revealWindow(window: BrowserWindow): void {
  if (window.isDestroyed()) {
    return;
  }

  window.show();
  window.focus();
}

async function loadSettingsPage(window: BrowserWindow, rendererURL: string | undefined, mode: SettingsWindowMode): Promise<void> {
  if (rendererURL) {
    await window.loadURL(`${rendererURL}/settings/index.html?mode=${mode}`);
    return;
  }

  const htmlPath = path.join(__dirname, "../../renderer/settings/index.html");
  await window.loadFile(htmlPath, { query: { mode } });
}

function titleForMode(mode: SettingsWindowMode): string {
  return mode === "onboarding" ? "Vorn Voice Setup" : "Vorn Voice Settings";
}

async function showLoadErrorPage(window: BrowserWindow | undefined, message: string): Promise<void> {
  if (!window || window.isDestroyed()) {
    return;
  }

  const html = `
    <html>
      <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 0; background: #f5f5f2; color: #1f1f1c; display: flex; align-items: center; justify-content: center; min-height: 100vh;">
        <div style="max-width: 480px; padding: 32px; background: white; border-radius: 16px; box-shadow: 0 18px 48px rgba(0, 0, 0, 0.08);">
          <h1 style="margin: 0 0 12px; font-size: 28px;">Startup issue</h1>
          <p style="margin: 0; font-size: 16px; line-height: 1.5;">${message}</p>
        </div>
      </body>
    </html>
  `;

  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}
