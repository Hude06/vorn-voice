import { Menu, Tray, nativeImage } from "electron";
import { AppSnapshot } from "../shared/types";
import { UpdateMenuState } from "./services/updateService";

export class TrayController {
  private tray: Tray;
  private menuState: UpdateMenuState = {
    enabled: true,
    label: "Automatic updates enabled",
    canInstall: false
  };

  constructor(
    private readonly onOpenSettings: () => void,
    private readonly onQuit: () => void,
    private readonly onCheckForUpdates: () => void,
    private readonly onInstallUpdate: () => void
  ) {
    const icon = createTrayIcon();
    this.tray = new Tray(icon);
    this.tray.setToolTip("Vorn Voice");

    this.tray.on("click", onOpenSettings);
    this.rebuildMenu();
  }

  update(snapshot: AppSnapshot): void {
    const mode = snapshot.mode[0].toUpperCase() + snapshot.mode.slice(1);
    this.tray.setTitle(`Vorn Voice: ${mode}`);
  }

  setUpdateMenuState(next: UpdateMenuState): void {
    this.menuState = next;
    this.rebuildMenu();
  }

  private rebuildMenu(): void {
    const items: Electron.MenuItemConstructorOptions[] = [
      { label: "Open Settings", click: this.onOpenSettings },
      { type: "separator" },
      {
        label: this.menuState.enabled ? "Automatic updates: On" : "Automatic updates: Off",
        enabled: false
      },
      { label: this.menuState.label, enabled: false },
      { label: "Check for Updates...", click: this.onCheckForUpdates }
    ];

    if (this.menuState.canInstall) {
      items.push({ label: "Restart to Install Update", click: this.onInstallUpdate });
    }

    items.push({ type: "separator" }, { label: "Quit Vorn Voice", click: this.onQuit });

    this.tray.setContextMenu(Menu.buildFromTemplate(items));
  }
}

function createTrayIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
      <rect x="6" y="3" width="6" height="8" rx="3" fill="black" />
      <path d="M4.5 8.5a4.5 4.5 0 0 0 9 0" fill="none" stroke="black" stroke-width="1.6" stroke-linecap="round" />
      <line x1="9" y1="12.2" x2="9" y2="15.2" stroke="black" stroke-width="1.6" stroke-linecap="round" />
      <line x1="6.7" y1="15.2" x2="11.3" y2="15.2" stroke="black" stroke-width="1.6" stroke-linecap="round" />
    </svg>
  `;

  const icon = nativeImage
    .createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`)
    .resize({ width: 18, height: 18 });

  if (process.platform === "darwin") {
    icon.setTemplateImage(true);
  }

  return icon;
}
