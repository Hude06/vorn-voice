import "./overlay.css";
import { OverlayPayload } from "../../shared/types";

const text = must<HTMLParagraphElement>("overlayText");
const state = must<HTMLParagraphElement>("overlayState");
const pulse = must<HTMLSpanElement>(".pulse", true);
const overlay = must<HTMLElement>(".overlay", true);

if (!window.voicebar) {
  overlay.dataset.state = "message";
  state.textContent = "Bridge unavailable";
  text.textContent = "Open settings and restart Vorn Voice after checking your runtime setup.";
} else {
  window.voicebar.onOverlayUpdate((payload: OverlayPayload) => {
    const labels = overlayLabels(payload.type, payload.text);

    overlay.dataset.state = payload.type;
    state.textContent = labels.kicker;
    text.textContent = labels.message;

    if (payload.type === "message") {
      pulse.classList.add("pause");
    } else {
      pulse.classList.remove("pause");
    }
  });
}

function overlayLabels(type: "listening" | "transcribing" | "message", textValue?: string): { kicker: string; message: string } {
  if (type === "listening") {
    return {
      kicker: "Listening",
      message: textValue ?? "Waiting for speech..."
    };
  }

  if (type === "transcribing") {
    return {
      kicker: "Transcribing",
      message: textValue ?? "Turning your voice into text..."
    };
  }

  return {
    kicker: "Ready",
    message: textValue ?? "Transcript delivered"
  };
}

function must<T extends Element>(selector: string, isQuery = false): T {
  const element = isQuery ? document.querySelector(selector) : document.getElementById(selector);
  if (!element) {
    throw new Error(`Missing element ${selector}`);
  }
  return element as T;
}
