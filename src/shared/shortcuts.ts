import { KeyboardShortcut } from "./types";

const UIOHOOK_KEY_NAMES: Record<number, string> = {
  1: "Escape",
  2: "1",
  3: "2",
  4: "3",
  5: "4",
  6: "5",
  7: "6",
  8: "7",
  9: "8",
  10: "9",
  11: "0",
  14: "Delete",
  15: "Tab",
  16: "Q",
  17: "W",
  18: "E",
  19: "R",
  20: "T",
  21: "Y",
  22: "U",
  23: "I",
  24: "O",
  25: "P",
  28: "Return",
  30: "A",
  31: "S",
  32: "D",
  33: "F",
  34: "G",
  35: "H",
  36: "J",
  37: "K",
  38: "L",
  44: "Z",
  45: "X",
  46: "C",
  47: "V",
  48: "B",
  49: "N",
  50: "M",
  57: "Space"
};

const LEGACY_KEY_NAMES: Record<number, string> = {
  36: "Return",
  48: "Tab",
  51: "Delete",
  53: "Escape"
};

const LEGACY_LETTERS: Record<number, string> = {
  0: "A",
  1: "S",
  2: "D",
  3: "F",
  4: "H",
  5: "G",
  6: "Z",
  7: "X",
  8: "C",
  9: "V",
  11: "B",
  12: "Q",
  13: "W",
  14: "E",
  15: "R",
  16: "Y",
  17: "T",
  31: "O",
  32: "U",
  34: "I",
  35: "P",
  37: "L",
  38: "J",
  40: "K",
  45: "N",
  46: "M"
};

const UIOHOOK_ACCELERATOR_KEYS: Record<number, string> = {
  1: "Escape",
  2: "1",
  3: "2",
  4: "3",
  5: "4",
  6: "5",
  7: "6",
  8: "7",
  9: "8",
  10: "9",
  11: "0",
  14: "Backspace",
  15: "Tab",
  16: "Q",
  17: "W",
  18: "E",
  19: "R",
  20: "T",
  21: "Y",
  22: "U",
  23: "I",
  24: "O",
  25: "P",
  28: "Enter",
  30: "A",
  31: "S",
  32: "D",
  33: "F",
  34: "G",
  35: "H",
  36: "J",
  37: "K",
  38: "L",
  44: "Z",
  45: "X",
  46: "C",
  47: "V",
  48: "B",
  49: "N",
  50: "M",
  57: "Space"
};

const LEGACY_ACCELERATOR_KEYS: Record<number, string> = {
  36: "Enter",
  48: "Tab",
  49: "Space",
  51: "Backspace",
  53: "Escape",
  ...LEGACY_LETTERS
};

export function formatShortcut(shortcut: KeyboardShortcut): string {
  if (shortcut.display) {
    return shortcut.display;
  }

  const parts: string[] = [];
  if (shortcut.modifiers.includes("ctrl")) parts.push("Control");
  if (shortcut.modifiers.includes("alt")) parts.push("Option");
  if (shortcut.modifiers.includes("shift")) parts.push("Shift");
  if (shortcut.modifiers.includes("cmd")) parts.push("Command");

  const keyName =
    UIOHOOK_KEY_NAMES[shortcut.keyCode] ??
    LEGACY_KEY_NAMES[shortcut.keyCode] ??
    LEGACY_LETTERS[shortcut.keyCode] ??
    `Key ${shortcut.keyCode}`;

  parts.push(keyName);
  return parts.join(" + ");
}

export function validateShortcut(shortcut: KeyboardShortcut): string | undefined {
  const display = shortcut.display?.toLowerCase();
  const usesLegacySpaceCode = shortcut.keyCode === 49 && display?.includes("space");

  if (shortcut.keyCode === 57 || usesLegacySpaceCode) {
    return "Space cannot be used in the recording shortcut";
  }

  if (shortcut.modifiers.length === 0) {
    return "Shortcut must include at least one modifier key";
  }

  const hasNonShiftModifier = shortcut.modifiers.some((modifier) => modifier !== "shift");
  if (!hasNonShiftModifier) {
    return "Shortcut must include Command, Control, or Option";
  }

  if (!toElectronAccelerator(shortcut)) {
    return "That key is not supported for global shortcuts";
  }

  return undefined;
}

export function toElectronAccelerator(shortcut: KeyboardShortcut): string | undefined {
  const key = UIOHOOK_ACCELERATOR_KEYS[shortcut.keyCode] ?? LEGACY_ACCELERATOR_KEYS[shortcut.keyCode];
  if (!key) {
    return undefined;
  }

  const parts: string[] = [];
  if (shortcut.modifiers.includes("cmd")) parts.push("Command");
  if (shortcut.modifiers.includes("ctrl")) parts.push("Control");
  if (shortcut.modifiers.includes("alt")) parts.push("Alt");
  if (shortcut.modifiers.includes("shift")) parts.push("Shift");
  parts.push(key);

  return parts.join("+");
}
