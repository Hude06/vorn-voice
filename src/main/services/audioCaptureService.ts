import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ChildProcess, spawn } from "node:child_process";

export class AudioCaptureService {
  private process?: ChildProcess;
  private outputPath?: string;

  async startCapture(): Promise<void> {
    if (this.process) {
      return;
    }

    const outputPath = path.join(os.tmpdir(), `voicebar-${randomUUID()}.wav`);
    this.outputPath = outputPath;

    const recorderPath = await this.resolveRecorderPath();

    const process = spawn(recorderPath, ["-q", "-d", "-c", "1", "-r", "16000", "-b", "16", outputPath]);

    await new Promise<void>((resolve, reject) => {
      process.once("spawn", () => resolve());
      process.once("error", (error: NodeJS.ErrnoException) => {
        reject(this.toStartCaptureError(error));
      });
    });

    this.process = process;
  }

  async stopCapture(): Promise<string> {
    if (!this.process || !this.outputPath) {
      throw new Error("Recording has not started");
    }

    const process = this.process;
    const outputPath = this.outputPath;

    await new Promise<void>((resolve) => {
      if (process.exitCode !== null || process.killed) {
        resolve();
        return;
      }

      process.once("exit", () => resolve());
      process.kill("SIGINT");
    });

    this.process = undefined;
    this.outputPath = undefined;

    const stat = await fs.stat(outputPath).catch(() => null);
    if (!stat) {
      throw new Error("Audio capture failed: Recorder did not produce an audio file");
    }

    if (stat.size < 1024) {
      throw new Error("No speech detected");
    }

    return outputPath;
  }

  private async resolveRecorderPath(): Promise<string> {
    const preferredPaths = [
      path.join(process.resourcesPath, "bin", "sox"),
      process.env.VOX_SOX_PATH,
      "/opt/homebrew/bin/sox",
      "/usr/local/bin/sox"
    ].filter((candidate): candidate is string => Boolean(candidate));

    for (const candidate of preferredPaths) {
      try {
        await fs.access(candidate, fsConstants.X_OK);
        return candidate;
      } catch {
        continue;
      }
    }

    return "sox";
  }

  private toStartCaptureError(error: NodeJS.ErrnoException): Error {
    if (error.code === "ENOENT") {
      return new Error("Audio capture failed: bundled recorder not found. Reinstall Vorn Voice or install SoX.");
    }

    return new Error(`Audio capture failed: ${error.message}`);
  }
}
