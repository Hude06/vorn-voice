import { describe, expect, it, vi } from "vitest";
import { WhisperService } from "../src/main/services/whisperService";

describe("WhisperService long-audio handling", () => {
  it("fails without trying to install runtime during transcription", async () => {
    const service = new WhisperService() as any;

    service.locateCLIPath = vi.fn().mockResolvedValue({
      path: undefined,
      checkedPaths: [],
      pathEnv: ""
    });
    service.tryInstallWithHomebrew = vi.fn();

    await expect(service.ensureRuntimeAvailable()).rejects.toThrow(
      "whisper-cli not found. Install the Whisper runtime from Settings."
    );
    expect(service.tryInstallWithHomebrew).not.toHaveBeenCalled();
  });

  it("uses chunked transcription for long recordings", async () => {
    const service = new WhisperService() as any;

    service.ensureRuntimeAvailable = vi.fn().mockResolvedValue("/tmp/whisper-cli");
    service.getAudioDurationSeconds = vi.fn().mockResolvedValue(220);
    service.splitAudioIntoChunks = vi.fn().mockResolvedValue(["/tmp/chunk-1.wav", "/tmp/chunk-2.wav"]);
    service.transcribeSingle = vi
      .fn()
      .mockResolvedValueOnce("hello")
      .mockResolvedValueOnce("world");

    const transcript = await service.transcribe("/tmp/full.wav", "/tmp/model.bin");

    expect(transcript).toBe("hello world");
    expect(service.transcribeSingle).toHaveBeenCalledTimes(2);
    expect(service.splitAudioIntoChunks).toHaveBeenCalledTimes(1);
  });

  it("falls back to chunking when long audio returns suspiciously short text", async () => {
    const service = new WhisperService() as any;

    service.ensureRuntimeAvailable = vi.fn().mockResolvedValue("/tmp/whisper-cli");
    service.getAudioDurationSeconds = vi.fn().mockResolvedValue(60);
    service.splitAudioIntoChunks = vi.fn().mockResolvedValue(["/tmp/chunk-1.wav", "/tmp/chunk-2.wav"]);
    service.transcribeSingle = vi
      .fn()
      .mockResolvedValueOnce("you")
      .mockResolvedValueOnce("full")
      .mockResolvedValueOnce("sentence");

    const transcript = await service.transcribe("/tmp/full.wav", "/tmp/model.bin");

    expect(transcript).toBe("full sentence");
    expect(service.transcribeSingle).toHaveBeenCalledTimes(3);
    expect(service.splitAudioIntoChunks).toHaveBeenCalledTimes(1);
  });

  it("keeps single pass for shorter recordings", async () => {
    const service = new WhisperService() as any;

    service.ensureRuntimeAvailable = vi.fn().mockResolvedValue("/tmp/whisper-cli");
    service.getAudioDurationSeconds = vi.fn().mockResolvedValue(8);
    service.transcribeSingle = vi.fn().mockResolvedValue("short transcript");

    const transcript = await service.transcribe("/tmp/full.wav", "/tmp/model.bin");

    expect(transcript).toBe("short transcript");
    expect(service.transcribeSingle).toHaveBeenCalledTimes(1);
  });

  it("deduplicates overlapped chunk boundaries", () => {
    const service = new WhisperService() as any;

    const transcript = service.mergeChunkTranscripts([
      "hello there general kenobi",
      "general kenobi you are a bold one"
    ]);

    expect(transcript).toBe("hello there general kenobi you are a bold one");
  });

  it("surfaces chunk errors when every chunk fails", async () => {
    const service = new WhisperService() as any;

    service.ensureRuntimeAvailable = vi.fn().mockResolvedValue("/tmp/whisper-cli");
    service.getAudioDurationSeconds = vi.fn().mockResolvedValue(120);
    service.splitAudioIntoChunks = vi.fn().mockResolvedValue(["/tmp/chunk-1.wav"]);
    service.transcribeSingle = vi.fn().mockRejectedValue(new Error("whisper-cli failed"));

    await expect(service.transcribe("/tmp/full.wav", "/tmp/model.bin")).rejects.toThrow("whisper-cli failed");
  });
});
