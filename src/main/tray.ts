import fs from "node:fs";
import path from "node:path";
import { Menu, Tray, nativeImage } from "electron";
import { AppMode, AppSnapshot } from "../shared/types";
import { UpdateMenuState } from "./services/updateService";

const RECORDING_ANIMATION_INTERVAL_MS = 120;
const TRAY_ASSET_DIR = "tray";
const RECORDING_FRAME_SEQUENCE = [0, 1, 2, 3, 2, 1] as const;

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
    this.setRecordingAnimationFrame();
    this.recordingAnimation = setInterval(() => {
      this.recordingFrameIndex = (this.recordingFrameIndex + 1) % RECORDING_FRAME_SEQUENCE.length;
      this.setRecordingAnimationFrame();
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

  private setRecordingAnimationFrame(): void {
    const frameIndex = RECORDING_FRAME_SEQUENCE[this.recordingFrameIndex];
    this.tray.setImage(this.icons.recording[frameIndex]);
  }
}

function createTrayIcons(): TrayIcons {
  return {
    idle: loadTrayIcon("idleTemplate.png", [6, 10, 7]),
    recording: [
      loadTrayIcon("recording1Template.png", [7, 13, 8]),
      loadTrayIcon("recording2Template.png", [9, 11, 6]),
      loadTrayIcon("recording3Template.png", [6, 10, 9]),
      loadTrayIcon("recording4Template.png", [10, 7, 12])
    ]
  };
}

function loadTrayIcon(fileName: string, fallbackHeights: number[]): Electron.NativeImage {
  for (const candidate of getTrayIconCandidates(fileName)) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    const icon = nativeImage.createFromPath(candidate);
    if (!icon.isEmpty()) {
      if (process.platform === "darwin") {
        icon.setTemplateImage(true);
      }

      return icon;
    }
  }

  console.warn(`Tray icon asset could not be loaded: ${fileName}`);
  return createFallbackWaveformIcon(fallbackHeights);
}

function getTrayIconCandidates(fileName: string): string[] {
  return [
    path.join(process.resourcesPath, TRAY_ASSET_DIR, fileName),
    path.join(process.cwd(), "build", TRAY_ASSET_DIR, fileName),
    path.join(__dirname, "..", "..", "build", TRAY_ASSET_DIR, fileName)
  ];
}

function createFallbackWaveformIcon(heights: number[]): Electron.NativeImage {
  const iconSize = 18;
  const strokeWidth = 2.6;
  const totalWidth = 8;
  const startX = (iconSize - totalWidth) / 2;
  const step = totalWidth / Math.max(1, heights.length - 1);
  const centerY = iconSize / 2;
  const lines = heights.map((height, index) => {
    const x = startX + index * step;
    const y1 = centerY - height / 2;
    const y2 = centerY + height / 2;

    return `<line x1="${x.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="black" stroke-width="${strokeWidth}" stroke-linecap="round" />`;
  }).join("");
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${iconSize}" height="${iconSize}" viewBox="0 0 ${iconSize} ${iconSize}">
      ${lines}
    </svg>
  `;
  const icon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);

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
