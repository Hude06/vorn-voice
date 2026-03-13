import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { app } from "electron";
import { detectDesktopPlatform, type DesktopPlatform } from "../../shared/platform";
import { SpeechRuntimeDiagnostics, WhisperTranscriptionDiagnostics } from "../../shared/types";
import { terminateChildProcess } from "./processTermination";
import { isRunnableFile, locateRuntimeExecutable, type RuntimeExecutableLookup } from "./runtimeResolver";

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

type ChunkedTranscriptionResult = {
  blankChunkCount: number;
  chunkCount: number;
  text: string;
};

const LONG_AUDIO_THRESHOLD_SECONDS = 45;
const FORCE_CHUNK_AUDIO_THRESHOLD_SECONDS = 180;
const CHUNK_DURATION_SECONDS = 75;
const CHUNK_OVERLAP_SECONDS = 6;
const MIN_REASONABLE_WORDS_FOR_LONG_AUDIO = 2;
const OVERLAP_MATCH_WINDOW_WORDS = 24;
const COMMAND_TERMINATION_TIMEOUT_MS = 2_500;

export class WhisperService {
  private installAttempted = false;
  private installInFlight?: Promise<boolean>;
  private lastDiagnostics?: WhisperTranscriptionDiagnostics;
  private readonly platform: DesktopPlatform;
  private readonly packaged: boolean;

  constructor(
    platform: DesktopPlatform = detectDesktopPlatform(process.platform),
    packaged = app?.isPackaged ?? false
  ) {
    this.platform = platform;
    this.packaged = packaged;
  }

  async installRuntime(): Promise<SpeechRuntimeDiagnostics> {
    const existing = await this.getDiagnostics();
    if (existing.whisperCliFound && existing.soxFound) {
      return existing;
    }

    if (this.platform === "macos" && !this.packaged) {
      await this.tryInstallWithHomebrew(true);
    }

    return this.getDiagnostics();
  }

  async ensureRuntimeAvailable(): Promise<string> {
    const diagnostics = await this.getDiagnostics();
    if (diagnostics.whisperCliFound && diagnostics.whisperCliPath) {
      return diagnostics.whisperCliPath;
    }

    throw new Error(diagnostics.recoveryMessage ?? "whisper-cli not found. Install the speech runtime from Settings or add it to PATH.");
  }

  async transcribe(audioPath: string, modelPath: string, modelId = path.basename(modelPath)): Promise<string> {
    this.lastDiagnostics = undefined;
    const cliPath = await this.ensureRuntimeAvailable();
    const audioDurationSeconds = await this.getAudioDurationSeconds(audioPath);

    if (audioDurationSeconds !== undefined && audioDurationSeconds >= FORCE_CHUNK_AUDIO_THRESHOLD_SECONDS) {
      const chunked = await this.transcribeChunked(audioPath, modelPath, cliPath, audioDurationSeconds);
      this.lastDiagnostics = {
        runtimePath: cliPath,
        modelId,
        modelPath,
        audioDurationSeconds,
        chunked: true,
        chunkCount: chunked.chunkCount,
        blankChunkCount: chunked.blankChunkCount
      };
      return chunked.text;
    }

    const transcript = await this.transcribeSingle(audioPath, modelPath, cliPath);
    if (
      audioDurationSeconds !== undefined &&
      audioDurationSeconds >= LONG_AUDIO_THRESHOLD_SECONDS &&
      this.countWords(transcript) < MIN_REASONABLE_WORDS_FOR_LONG_AUDIO
    ) {
      const chunked = await this.transcribeChunked(audioPath, modelPath, cliPath, audioDurationSeconds);
      this.lastDiagnostics = {
        runtimePath: cliPath,
        modelId,
        modelPath,
        audioDurationSeconds,
        chunked: true,
        chunkCount: chunked.chunkCount,
        blankChunkCount: chunked.blankChunkCount
      };
      return chunked.text;
    }

    this.lastDiagnostics = {
      runtimePath: cliPath,
      modelId,
      modelPath,
      audioDurationSeconds,
      chunked: false,
      chunkCount: 1,
      blankChunkCount: 0
    };

    return transcript;
  }

  getLastDiagnostics(): WhisperTranscriptionDiagnostics | undefined {
    return this.lastDiagnostics;
  }

  private async transcribeChunked(
    audioPath: string,
    modelPath: string,
    cliPath: string,
    audioDurationSeconds: number
  ): Promise<ChunkedTranscriptionResult> {
    const chunks = await this.splitAudioIntoChunks(audioPath, audioDurationSeconds);
    if (chunks.length === 0) {
      return {
        text: await this.transcribeSingle(audioPath, modelPath, cliPath),
        chunkCount: 1,
        blankChunkCount: 0
      };
    }

    const chunkTranscripts: string[] = [];
    let blankChunkCount = 0;
    let lastChunkError: Error | undefined;
    for (const chunkPath of chunks) {
      try {
        const text = await this.transcribeSingle(chunkPath, modelPath, cliPath);
        if (text.trim().length > 0) {
          chunkTranscripts.push(text.trim());
        }
      } catch (error) {
        if (error instanceof Error) {
          if (error.message === "No speech detected") {
            blankChunkCount += 1;
          } else {
            lastChunkError = error;
          }
        }
      }
    }

    await Promise.all(chunks.map((chunkPath) => fs.unlink(chunkPath).catch(() => undefined)));

    const combined = this.mergeChunkTranscripts(chunkTranscripts);
    if (!combined) {
      if (lastChunkError) {
        throw lastChunkError;
      }
      throw new Error("No speech detected");
    }

    return {
      text: combined,
      chunkCount: chunks.length,
      blankChunkCount
    };
  }

  private async transcribeSingle(audioPath: string, modelPath: string, cliPath: string): Promise<string> {
    const outputPrefix = path.join(os.tmpdir(), `voicebar-whisper-${randomUUID()}`);
    const args = ["-m", modelPath, "-f", audioPath, "-otxt", "-of", outputPrefix, "-nt"];
    if (this.modelLikelyEnglish(modelPath)) {
      args.push("-l", "en");
    }

    await new Promise<void>((resolve, reject) => {
      const child = spawn(cliPath, args);

      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      child.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
          reject(new Error("whisper-cli not found. Install the speech runtime from Settings or add it to PATH."));
          return;
        }
        reject(new Error(`Failed to launch whisper-cli: ${error.message}`));
      });

      child.on("exit", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(stderr.trim() || "whisper-cli failed"));
      });
    });

    const transcriptPath = `${outputPrefix}.txt`;
    const text = (await fs.readFile(transcriptPath, "utf8")).trim();
    void fs.unlink(transcriptPath).catch(() => undefined);
    if (!text) {
      throw new Error("No speech detected");
    }
    return text;
  }

  private async getAudioDurationSeconds(audioPath: string): Promise<number | undefined> {
    const soxPath = await this.resolveSoxExecutable();
    if (!soxPath) {
      return undefined;
    }

    const result = await this.runCommand(soxPath, ["--i", "-D", audioPath]);
    if (result.code !== 0) {
      return undefined;
    }

    const value = Number(result.stdout.trim());
    if (!Number.isFinite(value) || value <= 0) {
      return undefined;
    }

    return value;
  }

  private async splitAudioIntoChunks(audioPath: string, durationSeconds: number): Promise<string[]> {
    const soxPath = await this.resolveSoxExecutable();
    if (!soxPath) {
      return [];
    }

    const chunks: string[] = [];
    const stride = Math.max(1, CHUNK_DURATION_SECONDS - CHUNK_OVERLAP_SECONDS);
    const chunkCount = Math.ceil(durationSeconds / stride);

    for (let index = 0; index < chunkCount; index += 1) {
      const start = index * stride;
      if (start >= durationSeconds) {
        break;
      }

      const length = Math.min(CHUNK_DURATION_SECONDS, Math.max(0, durationSeconds - start));
      if (length <= 0) {
        continue;
      }

      const chunkPath = path.join(os.tmpdir(), `voicebar-whisper-chunk-${randomUUID()}.wav`);
      const result = await this.runCommand(
        soxPath,
        [
          audioPath,
          chunkPath,
          "trim",
          `${start}`,
          `${length}`
        ],
        {},
        60_000
      );
      if (result.code === 0) {
        chunks.push(chunkPath);
      } else {
        await fs.unlink(chunkPath).catch(() => undefined);
      }
    }

    return chunks;
  }

  private async resolveSoxExecutable(): Promise<string | undefined> {
    const lookup = await this.locateSoxPath();

    return lookup.path;
  }

  private async locateSoxPath(): Promise<RuntimeExecutableLookup> {
    return locateRuntimeExecutable({
      baseNames: ["sox"],
      envKeys: ["VOX_SOX_PATH", "SOX_PATH"],
      fixedCandidates: this.platform === "macos"
        ? ["/opt/homebrew/bin/sox", "/usr/local/bin/sox"]
        : []
    });
  }

  private modelLikelyEnglish(modelPath: string): boolean {
    const fileName = path.basename(modelPath).toLowerCase();
    return fileName.includes(".en") || fileName.endsWith("-en.bin");
  }

  private countWords(text: string): number {
    if (!text.trim()) {
      return 0;
    }

    return text.trim().split(/\s+/).length;
  }

  private mergeChunkTranscripts(chunks: string[]): string {
    let combined = "";

    for (const chunk of chunks) {
      const normalizedChunk = this.normalizeTranscript(chunk);
      if (!normalizedChunk) {
        continue;
      }

      if (!combined) {
        combined = normalizedChunk;
        continue;
      }

      const overlapWords = this.findOverlapWordCount(combined, normalizedChunk);
      if (overlapWords > 0) {
        const nextWords = normalizedChunk.split(" ").slice(overlapWords).join(" ");
        if (nextWords) {
          combined = this.joinTranscriptParts(combined, nextWords);
        }
        continue;
      }

      combined = this.joinTranscriptParts(combined, normalizedChunk);
    }

    return combined.trim();
  }

  private normalizeTranscript(text: string): string {
    return text
      .replace(/\s+/g, " ")
      .replace(/\s+([,.;:!?])/g, "$1")
      .trim();
  }

  private findOverlapWordCount(existing: string, incoming: string): number {
    const existingWords = this.normalizeForOverlap(existing).split(" ").filter(Boolean);
    const incomingWords = this.normalizeForOverlap(incoming).split(" ").filter(Boolean);
    const maxOverlap = Math.min(existingWords.length, incomingWords.length, OVERLAP_MATCH_WINDOW_WORDS);

    for (let size = maxOverlap; size >= 2; size -= 1) {
      const existingSlice = existingWords.slice(existingWords.length - size).join(" ");
      const incomingSlice = incomingWords.slice(0, size).join(" ");
      if (existingSlice === incomingSlice) {
        return size;
      }
    }

    return 0;
  }

  private normalizeForOverlap(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9' ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private joinTranscriptParts(left: string, right: string): string {
    if (!left) {
      return right;
    }

    if (!right) {
      return left;
    }

    return /[\-\u2014\/]$/.test(left) ? `${left}${right}` : `${left} ${right}`;
  }

  async getDiagnostics(): Promise<SpeechRuntimeDiagnostics> {
    const [runtimeLookup, soxLookup] = await Promise.all([this.locateCLIPath(), this.locateSoxPath()]);
    return this.toDiagnostics(runtimeLookup, soxLookup);
  }

  private async locateCLIPath(): Promise<RuntimeExecutableLookup> {
    const lookup = await locateRuntimeExecutable({
      baseNames: ["whisper-cli", "main"],
      envKeys: ["VOX_RUNTIME_PATH", "WHISPER_CLI_PATH"],
      fixedCandidates: this.platform === "macos"
        ? [
          "/opt/homebrew/opt/whisper-cpp/bin/whisper-cli",
          "/usr/local/opt/whisper-cpp/bin/whisper-cli",
          "/opt/homebrew/bin/whisper-cli",
          "/usr/local/bin/whisper-cli",
          "/opt/homebrew/bin/main",
          "/usr/local/bin/main"
        ]
        : []
    });

    if (lookup.path || this.platform !== "macos") {
      return lookup;
    }

    const brewInstalledPath = await this.resolveFromInstalledBrewPrefix();
    if (!brewInstalledPath) {
      return lookup;
    }

    const checkedPaths = lookup.checkedPaths.includes(brewInstalledPath)
      ? lookup.checkedPaths
      : [...lookup.checkedPaths, brewInstalledPath];

    if (!(await isRunnableFile(brewInstalledPath))) {
      return {
        checkedPaths,
        pathEnv: lookup.pathEnv
      };
    }

    return {
      path: brewInstalledPath,
      checkedPaths,
      pathEnv: lookup.pathEnv
    };
  }

  private async resolveFromInstalledBrewPrefix(): Promise<string | undefined> {
    const brewPath = await this.resolveBrewExecutable();
    if (!brewPath) {
      return undefined;
    }

    const prefixResult = await this.runCommand(brewPath, ["--prefix", "whisper-cpp"]);
    if (prefixResult.code !== 0) {
      return undefined;
    }

    const prefix = prefixResult.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);

    if (!prefix) {
      return undefined;
    }

    const candidates = [path.join(prefix, "bin", "whisper-cli"), path.join(prefix, "bin", "main")];
    for (const candidate of candidates) {
      if (await isRunnableFile(candidate)) {
        return candidate;
      }
    }

    return undefined;
  }

  private async tryInstallWithHomebrew(force = false): Promise<string | undefined> {
    if (this.platform !== "macos") {
      return undefined;
    }

    if (this.installInFlight) {
      await this.installInFlight;
      return this.resolveFromInstalledBrewPrefix();
    }

    const existingPath = await this.resolveFromInstalledBrewPrefix();
    if (existingPath) {
      return existingPath;
    }

    if (this.installAttempted && !force) {
      return undefined;
    }

    const brewPath = await this.resolveBrewExecutable();
    if (!brewPath) {
      return undefined;
    }

    this.installAttempted = true;

    this.installInFlight = this.installWithHomebrew(brewPath);
    await this.installInFlight;
    this.installInFlight = undefined;

    return this.resolveFromInstalledBrewPrefix();
  }

  private async installWithHomebrew(brewPath: string): Promise<boolean> {
    const whisperInstalled = await this.ensureFormulaInstalled(brewPath, "whisper-cpp");
    const soxInstalled = await this.ensureFormulaInstalled(brewPath, "sox");
    return whisperInstalled && soxInstalled;
  }

  private async resolveBrewExecutable(): Promise<string | undefined> {
    const lookup = await locateRuntimeExecutable({
      baseNames: ["brew"],
      fixedCandidates: ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"]
    });

    return lookup.path;
  }

  private async runCommand(
    command: string,
    args: string[],
    extraEnv: Record<string, string> = {},
    timeoutMs = 30_000
  ): Promise<CommandResult> {
    return new Promise<CommandResult>((resolve) => {
      const child = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          ...extraEnv
        }
      });

      let stdout = "";
      let stderr = "";
      let settled = false;

      const finish = (result: CommandResult): void => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      const timer = setTimeout(() => {
        void terminateChildProcess(child, {
          platform: this.platform,
          gracefulSignal: "SIGTERM",
          totalTimeoutMs: COMMAND_TERMINATION_TIMEOUT_MS
        }).then(() => {
          finish({ code: -1, stdout, stderr: stderr || "Command timed out" });
        });
      }, timeoutMs);

      child.on("error", (error) => {
        finish({ code: -1, stdout, stderr: stderr || error.message });
      });

      child.on("exit", (code) => {
        finish({ code: code ?? -1, stdout, stderr });
      });
    });
  }

  private async ensureFormulaInstalled(brewPath: string, formula: string): Promise<boolean> {
    const listResult = await this.runCommand(brewPath, ["list", "--versions", formula]);
    if (listResult.code === 0) {
      return true;
    }

    const installResult = await this.runCommand(
      brewPath,
      ["install", formula],
      {
        HOMEBREW_NO_AUTO_UPDATE: "1"
      },
      10 * 60 * 1000
    );

    return installResult.code === 0;
  }

  private toDiagnostics(runtimeLookup: RuntimeExecutableLookup, soxLookup: RuntimeExecutableLookup): SpeechRuntimeDiagnostics {
    const whisperCliFound = Boolean(runtimeLookup.path);
    const soxFound = Boolean(soxLookup.path);
    const managementMode = !this.packaged && this.platform === "macos" ? "installable" : "bundled-only";

    return {
      whisperCliFound,
      whisperCliPath: runtimeLookup.path,
      soxFound,
      soxPath: soxLookup.path,
      managementMode,
      actionLabel: this.runtimeActionLabel(managementMode, whisperCliFound, soxFound),
      recoveryMessage: this.runtimeRecoveryMessage(managementMode, whisperCliFound, soxFound),
      checkedPaths: Array.from(new Set([...runtimeLookup.checkedPaths, ...soxLookup.checkedPaths])),
      pathEnv: runtimeLookup.pathEnv || soxLookup.pathEnv
    };
  }

  private runtimeActionLabel(
    managementMode: SpeechRuntimeDiagnostics["managementMode"],
    whisperCliFound: boolean,
    soxFound: boolean
  ): string {
    if (managementMode === "installable") {
      return whisperCliFound && soxFound ? "Reinstall runtime" : "Install runtime";
    }

    return "Refresh runtime status";
  }

  private runtimeRecoveryMessage(
    managementMode: SpeechRuntimeDiagnostics["managementMode"],
    whisperCliFound: boolean,
    soxFound: boolean
  ): string | undefined {
    if (whisperCliFound && soxFound) {
      return undefined;
    }

    if (managementMode === "installable") {
      return "Install whisper-cpp and SoX to use local transcription in development.";
    }

    if (this.packaged) {
      return "The bundled speech runtime is missing or incomplete. Reinstall Vorn Voice.";
    }

    return "Set VOX runtime paths or install whisper-cli and SoX to use local transcription in development.";
  }
}
