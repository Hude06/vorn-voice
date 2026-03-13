import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { applySpeechSample, createEmptySpeechStats, parseSpeechStats } from "../../shared/speechStats";
import type { SpeechSample, SpeechStats } from "../../shared/types";

type SpeechStatsLoadResult = {
  stats: SpeechStats;
  status: "ok" | "missing" | "blocked";
  errorMessage?: string;
};

export class SpeechStatsStore {
  private filePath = path.join(app.getPath("userData"), "speech-stats.json");

  load(): SpeechStats {
    return this.loadWithStatus().stats;
  }

  recordSample(sample: SpeechSample): SpeechStats {
    const current = this.loadWithStatus();
    if (current.status === "blocked") {
      throw new Error(current.errorMessage ?? "Could not save speech stats safely.");
    }

    const nextStats = applySpeechSample(current.stats, sample);
    this.write(nextStats);
    return nextStats;
  }

  private write(stats: SpeechStats): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(stats, null, 2), "utf8");
  }

  private loadWithStatus(): SpeechStatsLoadResult {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      JSON.parse(raw);
      return {
        stats: parseSpeechStats(raw),
        status: "ok"
      };
    } catch (error) {
      if (!isMissingFileError(error)) {
        return {
          stats: createEmptySpeechStats(),
          status: "blocked",
          errorMessage: "Could not read existing speech stats safely."
        };
      }
    }

    return this.loadFromLegacyPaths();
  }

  private loadFromLegacyPaths(): SpeechStatsLoadResult {
    for (const legacyPath of this.legacyFilePaths()) {
      try {
        const raw = fs.readFileSync(legacyPath, "utf8");
        JSON.parse(raw);
        const stats = parseSpeechStats(raw);
        this.write(stats);
        return {
          stats,
          status: "ok"
        };
      } catch (error) {
        if (!isMissingFileError(error)) {
          return {
            stats: createEmptySpeechStats(),
            status: "blocked",
            errorMessage: `Could not migrate existing speech stats from ${path.basename(path.dirname(legacyPath))}.`
          };
        }
      }
    }

    return {
      stats: createEmptySpeechStats(),
      status: "missing"
    };
  }

  private legacyFilePaths(): string[] {
    const appDataPath = app.getPath("appData");
    return [
      path.join(appDataPath, "voicebar", "speech-stats.json"),
      path.join(appDataPath, "Voicebar", "speech-stats.json")
    ];
  }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (error as { code?: string }).code === "ENOENT"
  );
}
