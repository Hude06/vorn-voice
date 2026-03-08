import { BrowserWindow, screen } from "electron";
import path from "node:path";
import { IPC_CHANNELS } from "../ipc/channels";
import { OverlayPayload, OverlayType } from "../../shared/types";

export class OverlayWindow {
  private window?: BrowserWindow;
  private hideTimer?: NodeJS.Timeout;
  private ready = false;
  private pendingPayload?: OverlayPayload;

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
      this.ready = false;
      this.pendingPayload = undefined;
      this.window = undefined;
    });

    this.window.webContents.on("did-start-loading", () => {
      this.ready = false;
    });

    this.window.webContents.on("did-finish-load", () => {
      this.ready = true;
      this.flushPendingPayload();
    });

    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.window.setIgnoreMouseEvents(true);

    if (rendererURL) {
      void this.window.loadURL(`${rendererURL}/overlay/index.html`).catch((error) => {
        this.ready = false;
        console.error("Failed to load overlay window", error);
        void this.showLoadErrorPage();
      });
    } else {
      void this.window.loadFile(htmlPath).catch((error) => {
        this.ready = false;
        console.error("Failed to load overlay window", error);
        void this.showLoadErrorPage();
      });
    }
  }

  show(type: OverlayType, text?: string): void {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }

    this.clearHideTimer();
    this.positionBottomCenter();
    this.pendingPayload = { type, text };
    this.flushPendingPayload();
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

  private flushPendingPayload(): void {
    if (!this.window || this.window.isDestroyed() || !this.ready || !this.pendingPayload) {
      return;
    }

    this.window.webContents.send(IPC_CHANNELS.overlayUpdate, this.pendingPayload);
  }

  private async showLoadErrorPage(): Promise<void> {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }

    const html = `
      <html>
        <body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:rgba(18,18,16,0.84);color:#f7f5ef;display:flex;align-items:center;justify-content:center;min-height:100vh;">
          <div style="padding:18px 20px;border-radius:16px;background:rgba(34,34,31,0.92);box-shadow:0 16px 32px rgba(0,0,0,0.24);text-align:center;max-width:280px;">
            <strong style="display:block;font-size:14px;letter-spacing:0.04em;text-transform:uppercase;opacity:0.82;">Overlay unavailable</strong>
            <p style="margin:8px 0 0;font-size:13px;line-height:1.45;">The overlay failed to load. Open settings to review the runtime and permissions.</p>
          </div>
        </body>
      </html>
    `;

    await this.window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  }
}
