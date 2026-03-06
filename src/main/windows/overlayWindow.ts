import { BrowserWindow, screen } from "electron";
import path from "node:path";
import { IPC_CHANNELS } from "../ipc/channels";

export type OverlayType = "listening" | "transcribing" | "message";

export class OverlayWindow {
  private window?: BrowserWindow;
  private hideTimer?: NodeJS.Timeout;

  create(preloadPath: string, rendererURL?: string): void {
    if (this.window && !this.window.isDestroyed()) {
      return;
    }

    const htmlPath = path.join(__dirname, "../../renderer/overlay/index.html");

    this.window = new BrowserWindow({
      width: 360,
      height: 110,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      show: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: true,
      focusable: false,
      webPreferences: {
        preload: preloadPath,
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    this.window.on("closed", () => {
      this.clearHideTimer();
      this.window = undefined;
    });

    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.window.setIgnoreMouseEvents(true);

    if (rendererURL) {
      void this.window.loadURL(`${rendererURL}/overlay/index.html`).catch((error) => {
        console.error("Failed to load overlay window", error);
      });
    } else {
      void this.window.loadFile(htmlPath).catch((error) => {
        console.error("Failed to load overlay window", error);
      });
    }
  }

  show(type: OverlayType, text?: string): void {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }

    this.clearHideTimer();
    this.positionBottomCenter();
    this.window.webContents.send(IPC_CHANNELS.overlayUpdate, { type, text });
    this.window.showInactive();
  }

  hide(delayMs = 0): void {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }

    this.clearHideTimer();

    if (delayMs <= 0) {
      this.window.hide();
      return;
    }

    this.hideTimer = setTimeout(() => {
      this.hideTimer = undefined;
      this.window?.hide();
    }, delayMs);
  }

  private clearHideTimer(): void {
    if (!this.hideTimer) {
      return;
    }

    clearTimeout(this.hideTimer);
    this.hideTimer = undefined;
  }

  private positionBottomCenter(): void {
    if (!this.window) {
      return;
    }

    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const { width, height, x, y } = display.workArea;
    const bounds = this.window.getBounds();

    this.window.setPosition(
      Math.round(x + (width / 2) - (bounds.width / 2)),
      Math.round(y + height - bounds.height - 42)
    );
  }
}
