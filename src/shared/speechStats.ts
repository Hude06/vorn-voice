import type { SpeechSample, SpeechStats } from "./types";

export const SPEECH_STATS_STORAGE_KEY = "voicebar.speechStats.v1";
export const MIN_SPEECH_SAMPLE_DURATION_MS = 500;

const MAX_DAILY_BUCKETS = 45;
const DAYS_IN_WEEK = 7;

export function createEmptySpeechStats(): SpeechStats {
  return {
    totalWords: 0,
    totalDurationMs: 0,
    sampleCount: 0,
    lastSampleId: null,
    lastSampleWpm: null,
    dailyWordBuckets: {}
  };
}

export function countWords(text: string): number {
  const normalized = text.trim();
  if (!normalized) {
    return 0;
  }

  return normalized.split(/\s+/u).length;
}

export function computeWpm(words: number, durationMs: number): number {
  if (words <= 0 || durationMs < MIN_SPEECH_SAMPLE_DURATION_MS) {
    return 0;
  }

  const minutes = durationMs / 60000;
  if (minutes <= 0) {
    return 0;
  }

  return words / minutes;
}

export function isValidSpeechSample(sample: SpeechSample): boolean {
  return sample.words > 0 && sample.durationMs >= MIN_SPEECH_SAMPLE_DURATION_MS && sample.createdAt > 0;
}

export function applySpeechSample(stats: SpeechStats, sample: SpeechSample): SpeechStats {
  if (!isValidSpeechSample(sample) || sample.id === stats.lastSampleId) {
    return stats;
  }

  const dateKey = toDateKey(sample.createdAt);
  const dailyWordBuckets = {
    ...stats.dailyWordBuckets,
    [dateKey]: (stats.dailyWordBuckets[dateKey] ?? 0) + sample.words
  };

  return {
    totalWords: stats.totalWords + sample.words,
    totalDurationMs: stats.totalDurationMs + sample.durationMs,
    sampleCount: stats.sampleCount + 1,
    lastSampleId: sample.id,
    lastSampleWpm: sample.wpm,
    dailyWordBuckets: trimDailyBuckets(dailyWordBuckets)
  };
}

export function averageWpm(stats: SpeechStats): number {
  return computeWpm(stats.totalWords, stats.totalDurationMs);
}

export function wordsThisWeek(stats: SpeechStats, now = Date.now()): number {
  let total = 0;

  for (let offset = 0; offset < DAYS_IN_WEEK; offset += 1) {
    const timestamp = now - offset * 24 * 60 * 60 * 1000;
    const dateKey = toDateKey(timestamp);
    total += stats.dailyWordBuckets[dateKey] ?? 0;
  }

  return total;
}

export function parseSpeechStats(value: string | null): SpeechStats {
  if (!value) {
    return createEmptySpeechStats();
  }

  try {
    return sanitizeSpeechStats(JSON.parse(value));
  } catch {
    return createEmptySpeechStats();
  }
}

function sanitizeSpeechStats(value: unknown): SpeechStats {
  if (!value || typeof value !== "object") {
    return createEmptySpeechStats();
  }

  const record = value as Record<string, unknown>;
  const totalWords = safeNumber(record.totalWords);
  const totalDurationMs = safeNumber(record.totalDurationMs);
  const sampleCount = safeNumber(record.sampleCount);
  const lastSampleId = typeof record.lastSampleId === "string" ? record.lastSampleId : null;
  const lastSampleWpm = typeof record.lastSampleWpm === "number" ? record.lastSampleWpm : null;
  const dailyWordBuckets = sanitizeDailyBuckets(record.dailyWordBuckets);

  return {
    totalWords,
    totalDurationMs,
    sampleCount,
    lastSampleId,
    lastSampleWpm,
    dailyWordBuckets: trimDailyBuckets(dailyWordBuckets)
  };
}

function sanitizeDailyBuckets(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const result: Record<string, number> = {};
  for (const [key, rawValue] of Object.entries(value as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
      continue;
    }

    const parsed = safeNumber(rawValue);
    if (parsed > 0) {
      result[key] = parsed;
    }
  }

  return result;
}

function trimDailyBuckets(buckets: Record<string, number>): Record<string, number> {
  const entries = Object.entries(buckets).sort(([a], [b]) => (a > b ? -1 : a < b ? 1 : 0));
  return Object.fromEntries(entries.slice(0, MAX_DAILY_BUCKETS));
}

function safeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function toDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
