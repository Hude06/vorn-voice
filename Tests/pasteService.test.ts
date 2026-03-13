import { beforeEach, describe, expect, it, vi } from "vitest";
import { clipboard } from "electron";

const clipboardState = {
  text: "",
  html: "",
  rtf: ""
};

const spawnMock = vi.fn();

vi.mock("electron", () => ({
  clipboard: {
    readText: vi.fn(() => clipboardState.text),
    writeText: vi.fn((value: string) => {
      clipboardState.text = value;
    }),
    readHTML: vi.fn(() => clipboardState.html),
    writeHTML: vi.fn((value: string) => {
      clipboardState.html = value;
    }),
    readRTF: vi.fn(() => clipboardState.rtf),
    writeRTF: vi.fn((value: string) => {
      clipboardState.rtf = value;
    }),
    clear: vi.fn(() => {
      clipboardState.text = "";
      clipboardState.html = "";
      clipboardState.rtf = "";
    })
  }
}));

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args)
}));

describe("PasteService clipboard restore", () => {
  beforeEach(() => {
    clipboardState.text = "";
    clipboardState.html = "";
    clipboardState.rtf = "";
    vi.clearAllMocks();
    vi.useFakeTimers();
    spawnMock.mockImplementation(() => createChild());
  });

  it("restores the previous clipboard when unchanged after paste", async () => {
    const { PasteService } = await import("../src/main/services/pasteService");

    clipboardState.text = "previous";
    const service = new PasteService();

    await service.pasteText("transcript", true);
    vi.advanceTimersByTime(300);

    expect(clipboardState.text).toBe("previous");
  });

  it("does not overwrite a newer clipboard value", async () => {
    const { PasteService } = await import("../src/main/services/pasteService");

    clipboardState.text = "previous";
    const service = new PasteService();

    await service.pasteText("transcript", true);
    clipboardState.text = "newer";
    vi.advanceTimersByTime(300);

    expect(clipboardState.text).toBe("newer");
  });

  it("pastes long transcripts in multiple chunks", async () => {
    const { PasteService } = await import("../src/main/services/pasteService");

    clipboardState.text = "previous";
    const service = new PasteService();
    const longTranscript = `${"word ".repeat(1500)}tail`;

    const pastePromise = service.pasteText(longTranscript, true);
    await vi.runAllTimersAsync();
    await pastePromise;

    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(clipboardState.text).toBe("previous");
  });

  it("preserves boundary whitespace when chunking long transcripts", async () => {
    const { PasteService } = await import("../src/main/services/pasteService");

    const service = new PasteService();
    const longTranscript = `${"a".repeat(3_998)} hello world`;

    const pastePromise = service.pasteText(longTranscript, false);
    await vi.runAllTimersAsync();
    await pastePromise;

    const writeCalls = (vi.mocked(clipboard.writeText).mock.calls as [string][]).map(([value]) => value);
    expect(writeCalls.length).toBeGreaterThan(1);
    expect(writeCalls.join("")).toBe(longTranscript.trim());
  });

  it("restores richer clipboard formats after paste", async () => {
    const { PasteService } = await import("../src/main/services/pasteService");

    clipboardState.text = "previous";
    clipboardState.html = "<b>previous</b>";
    clipboardState.rtf = "{\\rtf1 previous}";
    const service = new PasteService();

    await service.pasteText("transcript", true);
    vi.advanceTimersByTime(300);

    expect(clipboardState.text).toBe("previous");
    expect(clipboardState.html).toBe("<b>previous</b>");
    expect(clipboardState.rtf).toBe("{\\rtf1 previous}");
  });

  it("reports Windows helper availability when PowerShell exists", async () => {
    const { PasteService } = await import("../src/main/services/pasteService");

    const service = new PasteService("windows");

    await expect(service.getAvailability()).resolves.toEqual({ supported: true });
  });

  it("reports Windows helper-missing availability when PowerShell is absent", async () => {
    const { PasteService } = await import("../src/main/services/pasteService");
    spawnMock.mockImplementationOnce(() => createChild({ error: Object.assign(new Error("missing"), { code: "ENOENT" }) }));

    const service = new PasteService("windows");

    await expect(service.getAvailability()).resolves.toEqual({
      supported: false,
      statusMessage: "Auto-paste is unavailable because PowerShell could not be found."
    });
  });

  it("classifies Windows paste timeouts with manual-paste guidance", async () => {
    const { PasteService } = await import("../src/main/services/pasteService");
    spawnMock.mockImplementationOnce(() => createChild({ exitCode: undefined }));
    spawnMock.mockImplementationOnce(() => createChild({ exitCode: undefined }));

    const service = new PasteService("windows");

    const pastePromise = service.pasteText("transcript", false);
    const assertion = expect(pastePromise).rejects.toThrow("Auto-paste timed out. Paste manually or disable auto-paste.");
    await vi.advanceTimersByTimeAsync(4_500);

    await assertion;
  });
});

function createChild(options: { error?: NodeJS.ErrnoException; exitCode?: number } = { exitCode: 0 }) {
  return {
    on: (event: string, listener: (value?: number | Error) => void) => {
      if (event === "error" && options.error) {
        listener(options.error);
      }

      if (event === "exit" && options.exitCode !== undefined) {
        listener(options.exitCode);
      }
    },
    kill: vi.fn()
  };
}
