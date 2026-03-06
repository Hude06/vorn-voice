import { describe, expect, it } from "vitest";
import {
  applySpeechSample,
  averageWpm,
  computeWpm,
  countWords,
  createEmptySpeechStats,
  parseSpeechStats,
  wordsThisWeek
} from "../src/shared/speechStats";
import { SpeechSample } from "../src/shared/types";

describe("speech stats helpers", () => {
  it("counts transcript words using whitespace tokenization", () => {
    expect(countWords("  one   two\nthree\tfour ")).toBe(4);
  });

  it("returns zero WPM for invalid timing", () => {
    expect(computeWpm(12, 100)).toBe(0);
    expect(computeWpm(0, 10000)).toBe(0);
  });

  it("applies sample and computes weighted average WPM", () => {
    const base = createEmptySpeechStats();
    const first: SpeechSample = {
      id: "sample-1",
      words: 30,
      durationMs: 15000,
      wpm: 120,
      createdAt: Date.UTC(2026, 2, 2)
    };
    const second: SpeechSample = {
      id: "sample-2",
      words: 40,
      durationMs: 20000,
      wpm: 120,
      createdAt: Date.UTC(2026, 2, 2)
    };

    const withFirst = applySpeechSample(base, first);
    const withBoth = applySpeechSample(withFirst, second);

    expect(withBoth.sampleCount).toBe(2);
    expect(withBoth.totalWords).toBe(70);
    expect(withBoth.totalDurationMs).toBe(35000);
    expect(Math.round(averageWpm(withBoth))).toBe(120);
  });

  it("ignores duplicate sample ids", () => {
    const sample: SpeechSample = {
      id: "same",
      words: 25,
      durationMs: 12000,
      wpm: 125,
      createdAt: Date.UTC(2026, 2, 2)
    };

    const first = applySpeechSample(createEmptySpeechStats(), sample);
    const duplicate = applySpeechSample(first, sample);

    expect(duplicate).toBe(first);
  });

  it("sums rolling weekly words from daily buckets", () => {
    const now = Date.UTC(2026, 2, 9, 15, 0, 0);
    const stats = {
      ...createEmptySpeechStats(),
      dailyWordBuckets: {
        "2026-03-09": 100,
        "2026-03-08": 120,
        "2026-03-03": 140,
        "2026-03-01": 500
      }
    };

    expect(wordsThisWeek(stats, now)).toBe(360);
  });

  it("falls back to empty stats for malformed localStorage payloads", () => {
    expect(parseSpeechStats("not-json")).toEqual(createEmptySpeechStats());
    expect(parseSpeechStats('{"dailyWordBuckets":{"bad":5}}')).toEqual(createEmptySpeechStats());
  });
});
