import type { VoicebarApi } from "../shared/types";

declare global {
  interface Window {
    voicebar: VoicebarApi;
  }
}

export {};
