import { clipboard } from "electron";
import { spawn } from "node:child_process";

const MAX_CHARS_PER_PASTE = 4_000;
const CHUNK_PASTE_DELAY_MS = 45;
const CLIPBOARD_RESTORE_DELAY_MS = 300;
const PASTE_RETRY_COUNT = 2;

type ClipboardSnapshot = {
  text: string;
  html?: string;
  rtf?: string;
  bookmark?: { title: string; url: string };
};

export class PasteService {
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

  private async sendCommandV(): Promise<void> {
    let attempts = 0;

    while (attempts < PASTE_RETRY_COUNT) {
      attempts += 1;

      try {
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
            reject(new Error("Paste automation failed. Check Accessibility permissions."));
          });
        });

        return;
      } catch (error) {
        if (attempts >= PASTE_RETRY_COUNT) {
          throw error instanceof Error
            ? error
            : new Error("Paste automation failed. Check Accessibility permissions.");
        }

        await this.delay(CHUNK_PASTE_DELAY_MS);
      }
    }
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
}
