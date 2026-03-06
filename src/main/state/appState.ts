import { EventEmitter } from "node:events";
import { AppMode, AppSettings, AppSnapshot, SpeechSample } from "../../shared/types";

const MAX_TRANSCRIPT_PREVIEW_CHARS = 280;

export class AppState extends EventEmitter {
  private mode: AppMode = "idle";
  private errorMessage?: string;
  private lastTranscriptPreview = "";
  private lastTranscriptWordCount = 0;
  private lastTranscriptTruncated = false;
  private lastSpeechSample?: SpeechSample;

  constructor(private settings: AppSettings) {
    super();
  }

  getSnapshot(): AppSnapshot {
    return {
      mode: this.mode,
      errorMessage: this.errorMessage,
      lastTranscriptPreview: this.lastTranscriptPreview,
      lastTranscriptWordCount: this.lastTranscriptWordCount,
      lastTranscriptTruncated: this.lastTranscriptTruncated,
      settings: this.settings,
      lastSpeechSample: this.lastSpeechSample
    };
  }

  setMode(mode: AppMode, errorMessage?: string): void {
    this.mode = mode;
    this.errorMessage = errorMessage;
    this.emit("changed", this.getSnapshot());
  }

  setTranscript(text: string): void {
    const normalized = text.trim().replace(/\s+/g, " ");
    this.lastTranscriptWordCount = normalized ? normalized.split(/\s+/).length : 0;
    this.lastTranscriptTruncated = normalized.length > MAX_TRANSCRIPT_PREVIEW_CHARS;
    this.lastTranscriptPreview = this.lastTranscriptTruncated
      ? `${normalized.slice(0, MAX_TRANSCRIPT_PREVIEW_CHARS - 3).trimEnd()}...`
      : normalized;
    this.emit("changed", this.getSnapshot());
  }

  setSettings(settings: AppSettings): void {
    this.settings = settings;
    this.emit("changed", this.getSnapshot());
  }

  setSpeechSample(sample: SpeechSample): void {
    this.lastSpeechSample = sample;
    this.emit("changed", this.getSnapshot());
  }
}
