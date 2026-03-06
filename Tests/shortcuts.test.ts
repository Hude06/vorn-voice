import { describe, expect, it } from "vitest";
import { formatShortcut, toElectronAccelerator, validateShortcut } from "../src/shared/shortcuts";

describe("shortcut helpers", () => {
  it("formats a shortcut label", () => {
    expect(formatShortcut({ keyCode: 57, modifiers: ["cmd", "shift"] })).toBe("Shift + Command + Space");
  });

  it("prefers display label when provided", () => {
    expect(formatShortcut({ keyCode: 41, modifiers: ["ctrl"], display: "Control + F" })).toBe("Control + F");
  });

  it("rejects space-based shortcuts", () => {
    expect(validateShortcut({ keyCode: 57, modifiers: ["cmd"] })).toBe(
      "Space cannot be used in the recording shortcut"
    );
  });

  it("requires at least one modifier", () => {
    expect(validateShortcut({ keyCode: 19, modifiers: [] })).toBe("Shortcut must include at least one modifier key");
  });

  it("rejects shift-only shortcuts", () => {
    expect(validateShortcut({ keyCode: 19, modifiers: ["shift"] })).toBe(
      "Shortcut must include Command, Control, or Option"
    );
  });

  it("accepts modified non-space shortcuts", () => {
    expect(validateShortcut({ keyCode: 19, modifiers: ["cmd", "shift"] })).toBeUndefined();
  });

  it("allows keycode 49 when it is not legacy space", () => {
    expect(validateShortcut({ keyCode: 49, modifiers: ["cmd"], display: "Command + N" })).toBeUndefined();
  });

  it("converts shortcut to electron accelerator", () => {
    expect(toElectronAccelerator({ keyCode: 19, modifiers: ["cmd", "shift"] })).toBe("Command+Shift+R");
  });

  it("returns undefined for unsupported accelerator keycodes", () => {
    expect(toElectronAccelerator({ keyCode: 999, modifiers: ["cmd"] })).toBeUndefined();
  });
});
