import { Menu, Tray, nativeImage } from "electron";
import { AppMode, AppSnapshot } from "../shared/types";
import { UpdateMenuState } from "./services/updateService";

const TRAY_ICON_SIZE = 18;
const RECORDING_ANIMATION_INTERVAL_MS = 220;

type TrayIcons = {
  idle: Electron.NativeImage;
  recording: Electron.NativeImage[];
};

export class TrayController {
  private tray: Tray;
  private readonly icons: TrayIcons = createTrayIcons();
  private recordingAnimation?: ReturnType<typeof setInterval>;
  private recordingFrameIndex = 0;
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
    this.tray = new Tray(this.icons.idle);
    this.applyMode("idle");
    this.tray.setToolTip(buildToolTip("idle"));

    this.tray.on("click", onOpenSettings);
    this.rebuildMenu();
  }

  update(snapshot: AppSnapshot): void {
    this.applyMode(snapshot.mode);
    this.tray.setToolTip(buildToolTip(snapshot.mode));
  }

  setUpdateMenuState(next: UpdateMenuState): void {
    this.menuState = next;
    this.rebuildMenu();
  }

  dispose(): void {
    this.stopRecordingAnimation();
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

  private applyMode(mode: AppMode): void {
    if (process.platform === "darwin") {
      this.tray.setTitle("");
    } else {
      this.tray.setTitle(`Vorn Voice: ${formatMode(mode)}`);
    }

    if (mode === "listening") {
      this.startRecordingAnimation();
      return;
    }

    this.stopRecordingAnimation();
    this.tray.setImage(this.icons.idle);
  }

  private startRecordingAnimation(): void {
    if (this.recordingAnimation) {
      return;
    }

    this.recordingFrameIndex = 0;
    this.tray.setImage(this.icons.recording[this.recordingFrameIndex]);
    this.recordingAnimation = setInterval(() => {
      this.recordingFrameIndex = (this.recordingFrameIndex + 1) % this.icons.recording.length;
      this.tray.setImage(this.icons.recording[this.recordingFrameIndex]);
    }, RECORDING_ANIMATION_INTERVAL_MS);
  }

  private stopRecordingAnimation(): void {
    if (!this.recordingAnimation) {
      this.recordingFrameIndex = 0;
      return;
    }

    clearInterval(this.recordingAnimation);
    this.recordingAnimation = undefined;
    this.recordingFrameIndex = 0;
  }
}

function createTrayIcons(): TrayIcons {
  return {
    idle: createWaveformIcon([4.5, 7.5, 7.5, 4.5]),
    recording: [
      createWaveformIcon([4.5, 11, 7.5, 5]),
      createWaveformIcon([7.5, 10.5, 5, 8.5]),
      createWaveformIcon([5, 8, 11, 6]),
      createWaveformIcon([8, 5.5, 10.5, 7])
    ]
  };
}

function createWaveformIcon(heights: number[]): Electron.NativeImage {
  const barWidth = 1.8;
  const gap = 1.35;
  const radius = 0.9;
  const totalWidth = heights.length * barWidth + (heights.length - 1) * gap;
  const startX = (TRAY_ICON_SIZE - totalWidth) / 2;
  const centerY = TRAY_ICON_SIZE / 2;
  const rects = heights.map((height, index) => {
    const x = startX + index * (barWidth + gap);
    const y = centerY - height / 2;

    return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth}" height="${height.toFixed(2)}" rx="${radius}" fill="black" />`;
  }).join("");
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${TRAY_ICON_SIZE}" height="${TRAY_ICON_SIZE}" viewBox="0 0 ${TRAY_ICON_SIZE} ${TRAY_ICON_SIZE}">
      ${rects}
    </svg>
  `;
  const icon = nativeImage
    .createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`)
    .resize({ width: TRAY_ICON_SIZE, height: TRAY_ICON_SIZE });

  if (process.platform === "darwin") {
    icon.setTemplateImage(true);
  }

  return icon;
}

function buildToolTip(mode: AppMode): string {
  return `Vorn Voice - ${formatMode(mode)}`;
}

function formatMode(mode: AppMode): string {
  switch (mode) {
    case "idle":
      return "Ready";
    case "listening":
      return "Recording";
    case "transcribing":
      return "Transcribing";
    case "error":
      return "Error";
  }
}
