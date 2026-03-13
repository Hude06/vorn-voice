import { clipboard } from "electron";
import { spawn } from "node:child_process";
import { detectDesktopPlatform, type DesktopPlatform } from "../../shared/platform";

const MAX_CHARS_PER_PASTE = 4_000;
const CHUNK_PASTE_DELAY_MS = 45;
const CLIPBOARD_RESTORE_DELAY_MS = 300;
const PASTE_RETRY_COUNT = 2;
const WINDOWS_PASTE_TIMEOUT_MS = 2_000;

type ClipboardSnapshot = {
  text: string;
  html?: string;
  rtf?: string;
  bookmark?: { title: string; url: string };
};

export type AutoPasteAvailability = {
  supported: boolean;
  statusMessage?: string;
};

type WindowsPasteFailureReason = "helper-missing" | "helper-timeout" | "automation-blocked";

class PasteAutomationError extends Error {
  constructor(
    message: string,
    readonly reason: WindowsPasteFailureReason = "automation-blocked"
  ) {
    super(message);
  }
}

export class PasteService {
  constructor(private readonly platform: DesktopPlatform = detectDesktopPlatform(process.platform)) {}

  async pasteText(text: string, restoreClipboard: boolean): Promise<void> {
    const normalized = text.replace(/\r\n/g, "\n");
    const previous = this.captureClipboard();
    const chunks = this.chunkText(normalized);
    const finalChunk = chunks[chunks.length - 1] ?? normalized;

    for (let index = 0; index < chunks.length; index += 1) {
      clipboard.writeText(chunks[index]);
      await this.sendCommandV();

      if (index < chunks.length - 1) {
        await this.delay(CHUNK_PASTE_DELAY_MS);
      }
    }

    if (restoreClipboard) {
      setTimeout(() => {
        if (clipboard.readText() === finalChunk) {
          this.restoreClipboard(previous);
        }
      }, CLIPBOARD_RESTORE_DELAY_MS);
    }
  }

  async getAvailability(): Promise<AutoPasteAvailability> {
    if (this.platform !== "windows") {
      return { supported: true };
    }

    try {
      await this.spawnWindowsPasteHelper("$PSVersionTable.PSVersion.ToString() | Out-Null", WINDOWS_PASTE_TIMEOUT_MS);
      return { supported: true };
    } catch (error) {
      if (error instanceof PasteAutomationError) {
        return {
          supported: false,
          statusMessage: this.messageForFailureReason(error.reason)
        };
      }

      return {
        supported: false,
        statusMessage: "Auto-paste is unavailable on this Windows system."
      };
    }
  }

  private async sendCommandV(): Promise<void> {
    let attempts = 0;

    while (attempts < PASTE_RETRY_COUNT) {
      attempts += 1;

      try {
        await this.sendPasteShortcut();

        return;
      } catch (error) {
        if (attempts >= PASTE_RETRY_COUNT) {
          throw error instanceof Error
            ? error
            : new Error("Paste automation failed. Check app permissions and try again.");
        }

        await this.delay(CHUNK_PASTE_DELAY_MS);
      }
    }
  }

  private async sendPasteShortcut(): Promise<void> {
    if (this.platform === "windows") {
      await this.spawnWindowsPasteHelper(
        "$wshell = New-Object -ComObject WScript.Shell; $wshell.SendKeys('^v')",
        WINDOWS_PASTE_TIMEOUT_MS
      );
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const child = spawn("osascript", [
        "-e",
        'tell application "System Events" to keystroke "v" using command down'
      ]);

      child.on("error", (error) => {
        reject(error);
      });

      child.on("exit", (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error("Paste automation failed. Check app permissions and try again."));
      });
    });
  }

  private captureClipboard(): ClipboardSnapshot {
    const snapshot: ClipboardSnapshot = {
      text: clipboard.readText()
    };

    if (typeof clipboard.readHTML === "function") {
      snapshot.html = clipboard.readHTML();
    }

    if (typeof clipboard.readRTF === "function") {
      snapshot.rtf = clipboard.readRTF();
    }

    if (typeof clipboard.readBookmark === "function") {
      const bookmark = clipboard.readBookmark();
      if (bookmark?.title && bookmark.url) {
        snapshot.bookmark = bookmark;
      }
    }

    return snapshot;
  }

  private restoreClipboard(snapshot: ClipboardSnapshot): void {
    if (typeof clipboard.clear === "function") {
      clipboard.clear();
    }

    clipboard.writeText(snapshot.text);

    if (snapshot.html && typeof clipboard.writeHTML === "function") {
      clipboard.writeHTML(snapshot.html);
    }

    if (snapshot.rtf && typeof clipboard.writeRTF === "function") {
      clipboard.writeRTF(snapshot.rtf);
    }

    if (snapshot.bookmark && typeof clipboard.writeBookmark === "function") {
      clipboard.writeBookmark(snapshot.bookmark.title, snapshot.bookmark.url);
    }
  }

  private chunkText(text: string): string[] {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error("No speech detected");
    }

    if (trimmed.length <= MAX_CHARS_PER_PASTE) {
      return [trimmed];
    }

    const chunks: string[] = [];
    let start = 0;

    while (start < trimmed.length) {
      let end = Math.min(trimmed.length, start + MAX_CHARS_PER_PASTE);
      if (end < trimmed.length) {
        const breakpoint = trimmed.lastIndexOf(" ", end);
        if (breakpoint > start + Math.floor(MAX_CHARS_PER_PASTE * 0.6)) {
          end = breakpoint + 1;
        }
      }

      const chunk = trimmed.slice(start, end);
      if (chunk) {
        chunks.push(chunk);
      }
      start = end;
    }

    return chunks;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private async spawnWindowsPasteHelper(command: string, timeoutMs: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        command
      ]);

      let settled = false;

      const finish = (error?: Error): void => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        if (error) {
          reject(error);
          return;
        }

        resolve();
      };

      const timeout = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // Best-effort cleanup.
        }

        finish(new PasteAutomationError(this.messageForFailureReason("helper-timeout"), "helper-timeout"));
      }, timeoutMs);

      child.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
          finish(new PasteAutomationError(this.messageForFailureReason("helper-missing"), "helper-missing"));
          return;
        }

        finish(new PasteAutomationError(this.messageForFailureReason("automation-blocked"), "automation-blocked"));
      });

      child.on("exit", (code) => {
        if (code === 0) {
          finish();
          return;
        }

        finish(new PasteAutomationError(this.messageForFailureReason("automation-blocked"), "automation-blocked"));
      });
    });
  }

  private messageForFailureReason(reason: WindowsPasteFailureReason): string {
    switch (reason) {
      case "helper-missing":
        return "Auto-paste is unavailable because PowerShell could not be found.";
      case "helper-timeout":
        return "Auto-paste timed out. Paste manually or disable auto-paste.";
      default:
        return "Auto-paste could not control the target app. Paste manually or disable auto-paste.";
    }
  }
}
