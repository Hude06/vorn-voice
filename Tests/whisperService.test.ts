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
    service.locateSoxPath = vi.fn().mockResolvedValue({
      path: undefined,
      checkedPaths: [],
      pathEnv: ""
    });
    service.tryInstallWithHomebrew = vi.fn();

    await expect(service.ensureRuntimeAvailable()).rejects.toThrow(
      "Install whisper-cpp and SoX to use local transcription in development."
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

  it("reports packaged Windows runtime as bundled-only when tools are missing", async () => {
    const service = new WhisperService("windows", true) as any;

    service.locateCLIPath = vi.fn().mockResolvedValue({
      path: undefined,
      checkedPaths: ["C:/app/bin/whisper-cli.exe"],
      pathEnv: "C:/Windows/System32"
    });
    service.locateSoxPath = vi.fn().mockResolvedValue({
      path: undefined,
      checkedPaths: ["C:/app/bin/sox.exe"],
      pathEnv: "C:/Windows/System32"
    });

    await expect(service.getDiagnostics()).resolves.toEqual(expect.objectContaining({
      whisperCliFound: false,
      soxFound: false,
      managementMode: "bundled-only",
      actionLabel: "Refresh runtime status",
      recoveryMessage: "The bundled speech runtime is missing or incomplete. Reinstall Vorn Voice."
    }));
  });

  it("installs both whisper-cpp and sox through Homebrew in macOS development mode", async () => {
    const service = new WhisperService("macos", false) as any;
    service.locateCLIPath = vi.fn()
      .mockResolvedValueOnce({ path: undefined, checkedPaths: [], pathEnv: "" })
      .mockResolvedValueOnce({ path: "/opt/homebrew/bin/whisper-cli", checkedPaths: [], pathEnv: "" });
    service.locateSoxPath = vi.fn()
      .mockResolvedValueOnce({ path: undefined, checkedPaths: [], pathEnv: "" })
      .mockResolvedValueOnce({ path: "/opt/homebrew/bin/sox", checkedPaths: [], pathEnv: "" });
    service.resolveBrewExecutable = vi.fn().mockResolvedValue("/opt/homebrew/bin/brew");
    service.resolveFromInstalledBrewPrefix = vi.fn().mockResolvedValue(undefined);
    service.runCommand = vi
      .fn()
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    const diagnostics = await service.installRuntime();

    expect(service.runCommand).toHaveBeenCalledWith("/opt/homebrew/bin/brew", ["list", "--versions", "whisper-cpp"]);
    expect(service.runCommand).toHaveBeenCalledWith("/opt/homebrew/bin/brew", ["install", "whisper-cpp"], { HOMEBREW_NO_AUTO_UPDATE: "1" }, 600_000);
    expect(service.runCommand).toHaveBeenCalledWith("/opt/homebrew/bin/brew", ["list", "--versions", "sox"]);
    expect(service.runCommand).toHaveBeenCalledWith("/opt/homebrew/bin/brew", ["install", "sox"], { HOMEBREW_NO_AUTO_UPDATE: "1" }, 600_000);
    expect(diagnostics).toEqual(expect.objectContaining({
      whisperCliFound: true,
      soxFound: true,
      managementMode: "installable",
      actionLabel: "Reinstall runtime"
    }));
  });
});
