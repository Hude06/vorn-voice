import { app } from "electron";
import { autoUpdater } from "electron-updater";

const STARTUP_CHECK_DELAY_MS = 15000;
const PERIODIC_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type UpdateMenuState = {
  enabled: boolean;
  label: string;
  canInstall: boolean;
};

export class UpdateService {
  private initialized = false;
  private enabled = false;
  private menuState: UpdateMenuState = {
    enabled: true,
    label: "Automatic updates enabled",
    canInstall: false
  };
  private startupTimer?: NodeJS.Timeout;
  private intervalTimer?: NodeJS.Timeout;
  private checking = false;
  private currentCheckTrigger: "auto" | "manual" | undefined;
  private listeners = new Set<(state: UpdateMenuState) => void>();

  constructor(private readonly feedUrl?: string) {}

  start(enabled: boolean): void {
    if (!this.initialized) {
      this.initialized = true;
      this.configureUpdater();
      this.enabled = !enabled;
    }

    this.setEnabled(enabled);
  }

  stop(): void {
    this.clearTimers();
  }

  onMenuStateChanged(listener: (state: UpdateMenuState) => void): () => void {
    this.listeners.add(listener);
    listener(this.menuState);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) {
      return;
    }

    this.enabled = enabled;
    if (!this.canCheckForUpdates()) {
      this.updateMenuState({
        enabled: this.enabled,
        label: "Updates unavailable in development build",
        canInstall: false
      });
      return;
    }

    if (!this.enabled) {
      this.clearTimers();
      this.updateMenuState({
        enabled: false,
        label: "Automatic updates disabled",
        canInstall: false
      });
      return;
    }

    this.scheduleAutomaticChecks();
    this.updateMenuState({
      enabled: true,
      label: "Automatic updates enabled",
      canInstall: this.menuState.canInstall
    });
  }

  async checkForUpdatesManual(): Promise<void> {
    if (!this.canCheckForUpdates()) {
      this.updateMenuState({
        enabled: this.enabled,
        label: "Install a packaged app to check for updates",
        canInstall: false
      });
      return;
    }

    await this.checkForUpdates("manual");
  }

  installDownloadedUpdate(): void {
    if (!this.menuState.canInstall) {
      return;
    }

    autoUpdater.quitAndInstall();
  }

  private configureUpdater(): void {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    if (this.feedUrl) {
      autoUpdater.setFeedURL({ provider: "generic", url: this.feedUrl });
    }

    autoUpdater.on("checking-for-update", () => {
      this.updateMenuState({
        enabled: this.enabled,
        label: "Checking for updates...",
        canInstall: this.menuState.canInstall
      });
    });

    autoUpdater.on("update-available", () => {
      this.updateMenuState({
        enabled: this.enabled,
        label: "Update available, downloading...",
        canInstall: false
      });
    });

    autoUpdater.on("update-not-available", () => {
      this.updateMenuState({
        enabled: this.enabled,
        label: "App is up to date",
        canInstall: false
      });
    });

    autoUpdater.on("download-progress", (progress) => {
      this.updateMenuState({
        enabled: this.enabled,
        label: `Downloading update... ${Math.round(progress.percent)}%`,
        canInstall: false
      });
    });

    autoUpdater.on("update-downloaded", () => {
      this.updateMenuState({
        enabled: this.enabled,
        label: "Update downloaded. Restart to install",
        canInstall: true
      });
    });

    autoUpdater.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      const manualCheck = this.currentCheckTrigger === "manual";
      this.updateMenuState({
        enabled: this.enabled,
        label: manualCheck ? `Could not check for updates: ${message}` : "Automatic update check unavailable",
        canInstall: this.menuState.canInstall
      });
    });
  }

  private scheduleAutomaticChecks(): void {
    this.clearTimers();

    this.startupTimer = setTimeout(() => {
      void this.checkForUpdates();
    }, STARTUP_CHECK_DELAY_MS);

    this.intervalTimer = setInterval(() => {
      void this.checkForUpdates();
    }, PERIODIC_CHECK_INTERVAL_MS);
  }

  private clearTimers(): void {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = undefined;
    }

    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = undefined;
    }
  }

  private async checkForUpdates(trigger: "auto" | "manual" = "auto"): Promise<void> {
    if (this.checking) {
      return;
    }

    this.checking = true;
    this.currentCheckTrigger = trigger;
    try {
      await autoUpdater.checkForUpdates();
    } finally {
      this.currentCheckTrigger = undefined;
      this.checking = false;
    }
  }

  private canCheckForUpdates(): boolean {
    return app.isPackaged;
  }

  private updateMenuState(next: UpdateMenuState): void {
    this.menuState = next;
    this.listeners.forEach((listener) => listener(this.menuState));
  }
}
