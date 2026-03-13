import { beforeEach, describe, expect, it, vi } from "vitest";

const fileState = new Map<string, string>();

const readFileSyncMock = vi.fn((filePath: string) => {
  const value = fileState.get(filePath);
  if (value === undefined) {
    const error = new Error("ENOENT") as Error & { code?: string };
    error.code = "ENOENT";
    throw error;
  }
  return value;
});

const writeFileSyncMock = vi.fn((filePath: string, value: string) => {
  fileState.set(filePath, value);
});

const mkdirSyncMock = vi.fn();

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === "userData") {
        return "/tmp/vorn-voice";
      }

      if (name === "appData") {
        return "/tmp/app-support";
      }

      throw new Error(`Unexpected path request: ${name}`);
    })
  }
}));

vi.mock("node:fs", () => ({
  default: {
    readFileSync: readFileSyncMock,
    writeFileSync: writeFileSyncMock,
    mkdirSync: mkdirSyncMock
  }
}));

describe("SpeechStatsStore", () => {
  beforeEach(() => {
    fileState.clear();
    vi.clearAllMocks();
    vi.resetModules();
    readFileSyncMock.mockImplementation((filePath: string) => {
      const value = fileState.get(filePath);
      if (value === undefined) {
        const error = new Error("ENOENT") as Error & { code?: string };
        error.code = "ENOENT";
        throw error;
      }
      return value;
    });
  });

  it("migrates stats from the legacy voicebar app data path", async () => {
    const legacyPath = "/tmp/app-support/voicebar/speech-stats.json";
    fileState.set(legacyPath, JSON.stringify({
      totalWords: 420,
      totalDurationMs: 180000,
      sampleCount: 3,
      lastSampleId: "sample-3",
      lastSampleWpm: 140,
      dailyWordBuckets: {
        "2026-03-10": 120,
        "2026-03-11": 300
      }
    }));

    const { SpeechStatsStore } = await import("../src/main/services/speechStatsStore");
    const store = new SpeechStatsStore();
    const stats = store.load();

    expect(stats.totalWords).toBe(420);
    expect(stats.sampleCount).toBe(3);
    expect(writeFileSyncMock).toHaveBeenCalledWith(
      "/tmp/vorn-voice/speech-stats.json",
      expect.stringContaining("\"totalWords\": 420"),
      "utf8"
    );
  });

  it("falls back to empty stats when neither current nor legacy files exist", async () => {
    const { SpeechStatsStore } = await import("../src/main/services/speechStatsStore");
    const store = new SpeechStatsStore();

    expect(store.load()).toEqual({
      totalWords: 0,
      totalDurationMs: 0,
      sampleCount: 0,
      lastSampleId: null,
      lastSampleWpm: null,
      dailyWordBuckets: {}
    });
  });

  it("refuses to overwrite stats when the canonical file is unreadable", async () => {
    readFileSyncMock.mockImplementation((filePath: string) => {
      if (filePath === "/tmp/vorn-voice/speech-stats.json") {
        return "{broken";
      }

      const error = new Error("ENOENT") as Error & { code?: string };
      error.code = "ENOENT";
      throw error;
    });

    const { SpeechStatsStore } = await import("../src/main/services/speechStatsStore");
    const store = new SpeechStatsStore();

    expect(() => store.recordSample({
      id: "sample-1",
      words: 10,
      durationMs: 1000,
      wpm: 120,
      createdAt: 1
    })).toThrow("Could not read existing speech stats safely.");
    expect(writeFileSyncMock).not.toHaveBeenCalled();
  });
});
