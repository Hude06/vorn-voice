import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { applySpeechSample, createEmptySpeechStats, parseSpeechStats } from "../../shared/speechStats";
import type { SpeechSample, SpeechStats } from "../../shared/types";

export class SpeechStatsStore {
  private filePath = path.join(app.getPath("userData"), "speech-stats.json");

  load(): SpeechStats {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      return parseSpeechStats(raw);
    } catch {
      return createEmptySpeechStats();
    }
  }

  recordSample(sample: SpeechSample): SpeechStats {
    const nextStats = applySpeechSample(this.load(), sample);
    this.write(nextStats);
    return nextStats;
  }

  private write(stats: SpeechStats): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(stats, null, 2), "utf8");
  }
}
