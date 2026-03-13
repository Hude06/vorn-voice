import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import { AudioCaptureService } from "../src/main/services/audioCaptureService";
import { terminateChildProcess } from "../src/main/services/processTermination";
import type { AudioSignalStats } from "../src/shared/types";

vi.mock("node:fs/promises", () => ({
  default: {
    stat: vi.fn(async () => ({ size: 4_096 })),
    unlink: vi.fn(async () => undefined)
  }
}));

vi.mock("../src/main/services/processTermination", () => ({
  terminateChildProcess: vi.fn(async () => true)
}));

function createStats(overrides: Partial<AudioSignalStats> = {}): AudioSignalStats {
  return {
    durationSeconds: 1.2,
    maxAmplitude: 0.02,
    rmsAmplitude: 0.004,
    ...overrides
  };
}

describe("AudioCaptureService cleanup fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.stat).mockResolvedValue({ size: 4_096 } as Awaited<ReturnType<typeof fs.stat>>);
    vi.mocked(terminateChildProcess).mockResolvedValue(true);
  });

  it("falls back to raw capture when balanced cleanup removes too much speech", async () => {
    const service = new AudioCaptureService() as any;

    service.resolveRecorderPath = vi.fn(async () => "/tmp/sox");
    service.analyzeAudio = vi
      .fn()
      .mockResolvedValueOnce(createStats())
      .mockResolvedValueOnce(createStats({ maxAmplitude: 0.0001, rmsAmplitude: 0.00005 }));
    service.runCommand = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }));

    const selectedPath = await service.finalizeCapture("/tmp/raw.wav", "balanced", { captureBackend: "spawn" });

    expect(selectedPath).toBe("/tmp/raw.wav");
    expect(service.getLastDiagnostics()).toMatchObject({
      requestedCleanupMode: "balanced",
      appliedCleanupMode: "off",
      fallbackUsed: true
    });
    expect(fs.unlink).toHaveBeenCalledWith(expect.stringContaining("voicebar-processed-balanced-"));
  });

  it("keeps aggressive cleanup when the processed audio still has clear speech", async () => {
    const service = new AudioCaptureService() as any;

    service.resolveRecorderPath = vi.fn(async () => "/tmp/sox");
    service.analyzeAudio = vi
      .fn()
      .mockResolvedValueOnce(createStats())
      .mockResolvedValueOnce(createStats({ durationSeconds: 0.8, maxAmplitude: 0.018, rmsAmplitude: 0.003 }));
    service.runCommand = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }));

    const selectedPath = await service.finalizeCapture("/tmp/raw.wav", "aggressive", { captureBackend: "spawn" });

    expect(selectedPath).toContain("voicebar-processed-aggressive-");
    expect(service.getLastDiagnostics()).toMatchObject({
      requestedCleanupMode: "aggressive",
      appliedCleanupMode: "aggressive",
      fallbackUsed: false
    });
    expect(fs.unlink).toHaveBeenCalledWith("/tmp/raw.wav");
  });

  it("surfaces no speech when the raw recording is effectively silent", async () => {
    const service = new AudioCaptureService() as any;

    service.resolveRecorderPath = vi.fn(async () => "/tmp/sox");
    service.analyzeAudio = vi.fn(async () => createStats({ maxAmplitude: 0.00001, rmsAmplitude: 0.00001 }));
    service.runCommand = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }));

    await expect(service.finalizeCapture("/tmp/raw.wav", "off", { captureBackend: "spawn" })).rejects.toThrow("No speech detected");
    expect(fs.unlink).toHaveBeenCalledWith("/tmp/raw.wav");
  });

  it("converts Windows spawn captures from raw PCM before finalizing", async () => {
    const service = new AudioCaptureService("windows") as any;

    service.process = { exitCode: null, killed: false };
    service.outputPath = "/tmp/capture.raw";
    service.resolveRecorderPath = vi.fn(async () => "/tmp/sox.exe");
    service.convertRawPcmToWav = vi.fn(async () => "/tmp/capture.wav");
    service.finalizeCapture = vi.fn(async () => "/tmp/capture.wav");

    const finalizedPath = await service.stopSpawnCapture("balanced", 120);

    expect(terminateChildProcess).toHaveBeenCalledTimes(1);
    expect(service.convertRawPcmToWav).toHaveBeenCalledWith("/tmp/sox.exe", "/tmp/capture.raw");
    expect(service.finalizeCapture).toHaveBeenCalledWith(
      "/tmp/capture.wav",
      "balanced",
      expect.objectContaining({
        captureBackend: "spawn",
        keyupToCaptureStoppedMs: 120
      })
    );
    expect(fs.unlink).toHaveBeenCalledWith("/tmp/capture.raw");
    expect(finalizedPath).toBe("/tmp/capture.wav");
  });

  it("fails fast when the recorder does not stop in time", async () => {
    const service = new AudioCaptureService("windows") as any;
    vi.mocked(terminateChildProcess).mockResolvedValue(false);

    service.process = { exitCode: null, killed: false };
    service.outputPath = "/tmp/capture.raw";

    await expect(service.stopSpawnCapture("balanced", 90)).rejects.toThrow(
      "Audio capture failed: recorder did not stop in time"
    );
    expect(fs.unlink).toHaveBeenCalledWith("/tmp/capture.raw");
  });
});
