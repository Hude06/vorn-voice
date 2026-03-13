import { randomUUID } from "node:crypto";
import { ChildProcess, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { detectDesktopPlatform, type DesktopPlatform } from "../../shared/platform";
import { AudioSignalStats, DEFAULT_SETTINGS, SpeechCaptureDiagnostics, SpeechCleanupMode } from "../../shared/types";
import { terminateChildProcess } from "./processTermination";
import { executableFileName, locateRuntimeExecutable } from "./runtimeResolver";

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

type RealtimeCaptureConfig = {
  lowLatencyEnabled: boolean;
  postRollMs: number;
  preRollMs: number;
};

type PersistentSession = {
  chunks: Buffer[];
  keydownToCaptureReadyMs: number;
  postRollMsRequested: number;
  preRollMsDelivered: number;
  preRollMsRequested: number;
};

const MIN_CAPTURE_BYTES = 1024;
const MIN_CAPTURE_SECONDS = 0.15;
const SILENT_MAX_AMPLITUDE = 0.0009;
const SILENT_RMS_AMPLITUDE = 0.00018;

const PCM_SAMPLE_RATE = 16_000;
const PCM_CHANNELS = 1;
const PCM_BYTES_PER_SAMPLE = 2;
const PCM_BYTES_PER_SECOND = PCM_SAMPLE_RATE * PCM_CHANNELS * PCM_BYTES_PER_SAMPLE;
const PCM_BYTES_PER_MS = PCM_BYTES_PER_SECOND / 1000;
const RING_BUFFER_MAX_MS = 2500;
const RING_BUFFER_MAX_BYTES = Math.round(PCM_BYTES_PER_MS * RING_BUFFER_MAX_MS);
const PROCESS_TERMINATION_TIMEOUT_MS = 2_500;

const PREPROCESS_EFFECTS: Record<Exclude<SpeechCleanupMode, "off">, string[]> = {
  balanced: ["highpass", "80", "gain", "-n", "-3"],
  aggressive: [
    "highpass",
    "80",
    "silence",
    "1",
    "0.12",
    "0.25%",
    "reverse",
    "silence",
    "1",
    "0.3",
    "0.25%",
    "reverse",
    "gain",
    "-n",
    "-3"
  ]
};

export class AudioCaptureService {
  private readonly platform: DesktopPlatform;
  private process?: ChildProcess;
  private outputPath?: string;
  private lastDiagnostics?: SpeechCaptureDiagnostics;
  private recorderPathCache?: string;
  private recorderPathInFlight?: Promise<string>;
  private captureConfig: RealtimeCaptureConfig = {
    lowLatencyEnabled: DEFAULT_SETTINGS.lowLatencyCaptureEnabled,
    preRollMs: DEFAULT_SETTINGS.preRollMs,
    postRollMs: DEFAULT_SETTINGS.postRollMs
  };
  private persistentProcess?: ChildProcess;
  private persistentStartInFlight?: Promise<void>;
  private ringChunks: Buffer[] = [];
  private ringBytes = 0;
  private persistentSession?: PersistentSession;
  private persistentRestartCount = 0;
  private captureReadyLatencyMs?: number;

  constructor(platform: DesktopPlatform = detectDesktopPlatform(process.platform)) {
    this.platform = platform;
  }

  configureRealtimeCapture(config: RealtimeCaptureConfig): void {
    this.captureConfig = {
      lowLatencyEnabled: config.lowLatencyEnabled,
      preRollMs: clampCaptureWindow(config.preRollMs, 0, 1200, DEFAULT_SETTINGS.preRollMs),
      postRollMs: clampCaptureWindow(config.postRollMs, 0, 1200, DEFAULT_SETTINGS.postRollMs)
    };

    if (!this.captureConfig.lowLatencyEnabled) {
      this.stopPersistentCapture();
    }
  }

  async startCapture(): Promise<void> {
    this.captureReadyLatencyMs = undefined;
    const captureStartedAt = Date.now();

    if (this.captureConfig.lowLatencyEnabled) {
      const ready = await this.startPersistentSession();
      if (ready) {
        this.captureReadyLatencyMs = Date.now() - captureStartedAt;
        if (this.persistentSession) {
          this.persistentSession.keydownToCaptureReadyMs = this.captureReadyLatencyMs;
        }
        return;
      }
    }

    await this.startSpawnCapture();
    this.captureReadyLatencyMs = Date.now() - captureStartedAt;
  }

  async prewarmCapture(): Promise<void> {
    if (this.captureConfig.lowLatencyEnabled) {
      await this.ensurePersistentCapture();
      return;
    }

    const recorderPath = await this.resolveRecorderPath();
    await this.runCommand(recorderPath, ["--version"], 4_000);
  }

  async stopCapture(requestedCleanupMode: SpeechCleanupMode = "balanced"): Promise<string> {
    const stopStartedAt = Date.now();

    if (this.persistentSession) {
      const session = this.persistentSession;
      this.persistentSession = undefined;

      if (session.postRollMsRequested > 0) {
        await wait(session.postRollMsRequested);
      }

      const rawAudio = Buffer.concat(session.chunks);
      const postRollDeliveredMs = session.postRollMsRequested;
      const keyupToCaptureStoppedMs = Date.now() - stopStartedAt;

      const tempRawPath = path.join(os.tmpdir(), `voicebar-persistent-${randomUUID()}.raw`);

      await fs.writeFile(tempRawPath, rawAudio);

      const recorderPath = await this.resolveRecorderPath();
      const wavPath = await this.convertRawPcmToWav(recorderPath, tempRawPath);
      await fs.unlink(tempRawPath).catch(() => undefined);

      const metadata = {
        captureBackend: "persistent" as const,
        preRollMsRequested: session.preRollMsRequested,
        preRollMsDelivered: session.preRollMsDelivered,
        postRollMsRequested: session.postRollMsRequested,
        postRollMsDelivered: postRollDeliveredMs,
        keydownToCaptureReadyMs: session.keydownToCaptureReadyMs,
        keyupToCaptureStoppedMs
      };

      return this.finalizeCapture(wavPath, requestedCleanupMode, metadata);
    }

    return this.stopSpawnCapture(requestedCleanupMode, Date.now() - stopStartedAt);
  }

  async shutdown(): Promise<void> {
    this.stopPersistentCapture();

    if (this.process && this.outputPath) {
      const process = this.process;
      const outputPath = this.outputPath;
      this.process = undefined;
      this.outputPath = undefined;

      await terminateChildProcess(process, {
        platform: this.platform,
        totalTimeoutMs: PROCESS_TERMINATION_TIMEOUT_MS
      });

      await fs.unlink(outputPath).catch(() => undefined);
    }
  }

  getLastDiagnostics(): SpeechCaptureDiagnostics | undefined {
    return this.lastDiagnostics;
  }

  private async startSpawnCapture(): Promise<void> {
    if (this.process) {
      return;
    }

    this.lastDiagnostics = undefined;
    const outputPath = path.join(
      os.tmpdir(),
      `voicebar-${randomUUID()}.${this.usesRawSpawnCapture() ? "raw" : "wav"}`
    );
    this.outputPath = outputPath;

    const recorderPath = await this.resolveRecorderPath();
    const process = spawn(recorderPath, this.spawnCaptureArgs(outputPath));

    await new Promise<void>((resolve, reject) => {
      process.once("spawn", () => resolve());
      process.once("error", (error: NodeJS.ErrnoException) => {
        reject(this.toStartCaptureError(error));
      });
    });

    this.process = process;
  }

  private async stopSpawnCapture(requestedCleanupMode: SpeechCleanupMode, keyupToCaptureStoppedMs: number): Promise<string> {
    if (!this.process || !this.outputPath) {
      throw new Error("Recording has not started");
    }

    const process = this.process;
    const outputPath = this.outputPath;

    const stopped = await terminateChildProcess(process, {
      platform: this.platform,
      totalTimeoutMs: PROCESS_TERMINATION_TIMEOUT_MS
    });

    this.process = undefined;
    this.outputPath = undefined;

    if (!stopped) {
      await fs.unlink(outputPath).catch(() => undefined);
      throw new Error("Audio capture failed: recorder did not stop in time");
    }

    const stat = await fs.stat(outputPath).catch(() => null);
    if (!stat) {
      throw new Error("Audio capture failed: Recorder did not produce an audio file");
    }

    if (stat.size < MIN_CAPTURE_BYTES) {
      await fs.unlink(outputPath).catch(() => undefined);
      throw new Error("No speech detected");
    }

    const capturedPath = this.usesRawSpawnCapture()
      ? await this.convertRawPcmToWav(await this.resolveRecorderPath(), outputPath)
      : outputPath;

    if (capturedPath !== outputPath) {
      await fs.unlink(outputPath).catch(() => undefined);
    }

    return this.finalizeCapture(capturedPath, requestedCleanupMode, {
      captureBackend: "spawn",
      keydownToCaptureReadyMs: this.captureReadyLatencyMs,
      keyupToCaptureStoppedMs
    });
  }

  private async startPersistentSession(): Promise<boolean> {
    try {
      await this.ensurePersistentCapture();
    } catch {
      return false;
    }

    if (!this.persistentProcess) {
      return false;
    }

    const preRollMsRequested = this.captureConfig.preRollMs;
    const preRollChunk = this.snapshotRingChunk(preRollMsRequested);
    const preRollMsDelivered = this.bytesToMs(preRollChunk.length);

    this.persistentSession = {
      chunks: preRollChunk.length > 0 ? [preRollChunk] : [],
      preRollMsRequested,
      preRollMsDelivered,
      postRollMsRequested: this.captureConfig.postRollMs,
      keydownToCaptureReadyMs: 0
    };

    return true;
  }

  private async ensurePersistentCapture(): Promise<void> {
    if (this.persistentProcess && this.persistentProcess.exitCode === null && !this.persistentProcess.killed) {
      return;
    }

    if (this.persistentStartInFlight) {
      return this.persistentStartInFlight;
    }

    this.persistentStartInFlight = this.startPersistentCaptureProcess();
    try {
      await this.persistentStartInFlight;
    } finally {
      this.persistentStartInFlight = undefined;
    }
  }

  private async startPersistentCaptureProcess(): Promise<void> {
    const recorderPath = await this.resolveRecorderPath();
    const process = spawn(
      recorderPath,
      ["-q", "-d", "-c", "1", "-r", "16000", "-b", "16", "-e", "signed", "-t", "raw", "-"],
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    await new Promise<void>((resolve, reject) => {
      process.once("spawn", () => resolve());
      process.once("error", (error: NodeJS.ErrnoException) => reject(this.toStartCaptureError(error)));
    });

    process.stdout.on("data", (chunk: Buffer) => {
      if (!chunk.length) {
        return;
      }

      this.pushRingChunk(chunk);
      if (this.persistentSession) {
        this.persistentSession.chunks.push(Buffer.from(chunk));
      }
    });

    process.on("exit", () => {
      if (this.persistentProcess === process) {
        this.persistentProcess = undefined;
      }
      this.persistentRestartCount += 1;
    });

    process.stderr.on("data", () => undefined);
    this.persistentProcess = process;
  }

  private stopPersistentCapture(): void {
    if (this.persistentProcess && this.persistentProcess.exitCode === null && !this.persistentProcess.killed) {
      void terminateChildProcess(this.persistentProcess, {
        platform: this.platform,
        gracefulSignal: "SIGTERM",
        totalTimeoutMs: PROCESS_TERMINATION_TIMEOUT_MS
      });
    }

    this.persistentProcess = undefined;
    this.persistentSession = undefined;
    this.ringChunks = [];
    this.ringBytes = 0;
  }

  private usesRawSpawnCapture(): boolean {
    return this.platform === "windows";
  }

  private spawnCaptureArgs(outputPath: string): string[] {
    if (this.usesRawSpawnCapture()) {
      return ["-q", "-d", "-c", "1", "-r", "16000", "-b", "16", "-e", "signed", "-t", "raw", outputPath];
    }

    return ["-q", "-d", "-c", "1", "-r", "16000", "-b", "16", outputPath];
  }

  private async convertRawPcmToWav(recorderPath: string, rawPath: string): Promise<string> {
    const wavPath = path.join(os.tmpdir(), `voicebar-${randomUUID()}.wav`);
    const convertResult = await this.runCommand(
      recorderPath,
      ["-q", "-t", "raw", "-r", "16000", "-b", "16", "-e", "signed", "-c", "1", rawPath, wavPath],
      60_000
    );

    if (convertResult.code !== 0) {
      await fs.unlink(wavPath).catch(() => undefined);
      throw new Error(convertResult.stderr.trim() || "Audio capture failed: could not finalize audio");
    }

    return wavPath;
  }

  private pushRingChunk(chunk: Buffer): void {
    this.ringChunks.push(Buffer.from(chunk));
    this.ringBytes += chunk.length;

    while (this.ringBytes > RING_BUFFER_MAX_BYTES && this.ringChunks.length > 0) {
      const removed = this.ringChunks.shift();
      if (!removed) {
        break;
      }
      this.ringBytes -= removed.length;
    }
  }

  private snapshotRingChunk(preRollMs: number): Buffer {
    const requestedBytes = Math.round(PCM_BYTES_PER_MS * preRollMs);
    if (requestedBytes <= 0 || this.ringChunks.length === 0) {
      return Buffer.alloc(0);
    }

    const combined = Buffer.concat(this.ringChunks);
    if (combined.length <= requestedBytes) {
      return combined;
    }

    return combined.subarray(combined.length - requestedBytes);
  }

  private bytesToMs(value: number): number {
    if (value <= 0) {
      return 0;
    }

    return Math.round(value / PCM_BYTES_PER_MS);
  }

  private async finalizeCapture(
    rawPath: string,
    requestedCleanupMode: SpeechCleanupMode,
    metadata: {
      captureBackend: "persistent" | "spawn";
      keydownToCaptureReadyMs?: number;
      keyupToCaptureStoppedMs?: number;
      postRollMsDelivered?: number;
      postRollMsRequested?: number;
      preRollMsDelivered?: number;
      preRollMsRequested?: number;
    }
  ): Promise<string> {
    const recorderPath = await this.resolveRecorderPath();
    const rawStats = await this.analyzeAudio(recorderPath, rawPath);
    if (!rawStats || rawStats.durationSeconds < MIN_CAPTURE_SECONDS) {
      await fs.unlink(rawPath).catch(() => undefined);
      throw new Error("No speech detected");
    }

    const attempts = this.getAttemptModes(requestedCleanupMode);
    const generatedPaths: string[] = [];
    let selectedPath: string | undefined;
    let selectedStats: AudioSignalStats | undefined;
    let selectedMode: SpeechCleanupMode | undefined;

    for (const mode of attempts) {
      const result = await this.prepareCandidate(recorderPath, rawPath, rawStats, mode);
      if (!result) {
        continue;
      }

      if (result.path !== rawPath) {
        generatedPaths.push(result.path);
      }

      if (this.hasUsableSpeech(result.stats)) {
        selectedPath = result.path;
        selectedStats = result.stats;
        selectedMode = mode;
        break;
      }
    }

    if (!selectedPath || !selectedStats || !selectedMode) {
      await Promise.all(generatedPaths.map((candidatePath) => fs.unlink(candidatePath).catch(() => undefined)));
      await fs.unlink(rawPath).catch(() => undefined);
      throw new Error("No speech detected");
    }

    this.lastDiagnostics = {
      requestedCleanupMode,
      appliedCleanupMode: selectedMode,
      fallbackUsed: selectedMode !== requestedCleanupMode,
      captureBackend: metadata.captureBackend,
      preRollMsRequested: metadata.preRollMsRequested,
      preRollMsDelivered: metadata.preRollMsDelivered,
      postRollMsRequested: metadata.postRollMsRequested,
      postRollMsDelivered: metadata.postRollMsDelivered,
      keydownToCaptureReadyMs: metadata.keydownToCaptureReadyMs,
      keyupToCaptureStoppedMs: metadata.keyupToCaptureStoppedMs,
      raw: rawStats,
      final: selectedStats
    };

    await Promise.all(
      generatedPaths
        .filter((candidatePath) => candidatePath !== selectedPath)
        .map((candidatePath) => fs.unlink(candidatePath).catch(() => undefined))
    );

    if (selectedPath !== rawPath) {
      await fs.unlink(rawPath).catch(() => undefined);
    }

    return selectedPath;
  }

  private getAttemptModes(requestedCleanupMode: SpeechCleanupMode): SpeechCleanupMode[] {
    switch (requestedCleanupMode) {
      case "aggressive":
        return ["aggressive", "balanced", "off"];
      case "balanced":
        return ["balanced", "off"];
      default:
        return ["off"];
    }
  }

  private async prepareCandidate(
    recorderPath: string,
    rawPath: string,
    rawStats: AudioSignalStats,
    mode: SpeechCleanupMode
  ): Promise<{ path: string; stats: AudioSignalStats } | undefined> {
    if (mode === "off") {
      return { path: rawPath, stats: rawStats };
    }

    const processedPath = path.join(os.tmpdir(), `voicebar-processed-${mode}-${randomUUID()}.wav`);
    const preprocessResult = await this.runCommand(
      recorderPath,
      [rawPath, processedPath, ...PREPROCESS_EFFECTS[mode]],
      60_000
    );

    if (preprocessResult.code !== 0) {
      await fs.unlink(processedPath).catch(() => undefined);
      return undefined;
    }

    const processedStats = await this.analyzeAudio(recorderPath, processedPath);
    if (!processedStats || processedStats.durationSeconds < MIN_CAPTURE_SECONDS) {
      await fs.unlink(processedPath).catch(() => undefined);
      return undefined;
    }

    return { path: processedPath, stats: processedStats };
  }

  private hasUsableSpeech(stats: AudioSignalStats): boolean {
    return (
      stats.durationSeconds >= MIN_CAPTURE_SECONDS &&
      (stats.maxAmplitude >= SILENT_MAX_AMPLITUDE || stats.rmsAmplitude >= SILENT_RMS_AMPLITUDE)
    );
  }

  private async resolveRecorderPath(): Promise<string> {
    if (this.recorderPathCache) {
      return this.recorderPathCache;
    }

    if (this.recorderPathInFlight) {
      return this.recorderPathInFlight;
    }

    this.recorderPathInFlight = this.resolveRecorderPathUncached();
    const resolved = await this.recorderPathInFlight;
    this.recorderPathCache = resolved;
    this.recorderPathInFlight = undefined;
    return resolved;
  }

  private async resolveRecorderPathUncached(): Promise<string> {
    const lookup = await locateRuntimeExecutable({
      baseNames: ["sox"],
      envKeys: ["VOX_SOX_PATH", "SOX_PATH"],
      fixedCandidates: this.platform === "macos"
        ? ["/opt/homebrew/bin/sox", "/usr/local/bin/sox"]
        : []
    });

    return lookup.path ?? executableFileName("sox");
  }

  private async analyzeAudio(recorderPath: string, audioPath: string): Promise<AudioSignalStats | undefined> {
    const result = await this.runCommand(recorderPath, [audioPath, "-n", "stat"], 10_000);
    if (result.code !== 0 && !result.stderr.includes("Maximum amplitude")) {
      return undefined;
    }

    return {
      durationSeconds: this.readStatValue(result.stderr, /Length \(seconds\):\s*([0-9.]+)/),
      maxAmplitude: this.readStatValue(result.stderr, /Maximum amplitude:\s*([0-9.]+)/),
      rmsAmplitude: this.readStatValue(result.stderr, /RMS\s+amplitude:\s*([0-9.]+)/)
    };
  }

  private readStatValue(output: string, pattern: RegExp): number {
    const match = output.match(pattern);
    const value = Number(match?.[1] ?? 0);
    return Number.isFinite(value) ? value : 0;
  }

  private async runCommand(command: string, args: string[], timeoutMs: number): Promise<CommandResult> {
    return new Promise<CommandResult>((resolve) => {
      const child = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"]
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
          totalTimeoutMs: PROCESS_TERMINATION_TIMEOUT_MS
        }).then(() => {
          finish({ code: -1, stdout, stderr: stderr || "Audio command timed out" });
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

  private toStartCaptureError(error: NodeJS.ErrnoException): Error {
    if (error.code === "ENOENT") {
      return new Error("Audio capture failed: recorder not found. Reinstall Vorn Voice or add SoX to PATH.");
    }

    return new Error(`Audio capture failed: ${error.message}`);
  }
}

function clampCaptureWindow(value: number, minimum: number, maximum: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

async function wait(durationMs: number): Promise<void> {
  if (durationMs <= 0) {
    return;
  }

  await new Promise<void>((resolve) => {
    setTimeout(() => resolve(), durationMs);
  });
}
