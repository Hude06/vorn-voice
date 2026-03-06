import { globalShortcut } from "electron";
import { KeyboardShortcut, Modifier } from "../../shared/types";
import { formatShortcut, toElectronAccelerator, validateShortcut } from "../../shared/shortcuts";

type HotkeyCallback = () => void;
type CaptureCallback = (shortcut: KeyboardShortcut) => void;

type IOHook = {
  on(event: "keydown" | "keyup", listener: (event: any) => void): void;
  removeAllListeners(event: "keydown" | "keyup"): void;
  start(): void;
  stop(): void;
};

let cachedIOHook: IOHook | undefined;

function loadIOHook(): IOHook {
  if (cachedIOHook) {
    return cachedIOHook;
  }

  try {
    const uiohookModule = require("uiohook-napi");
    cachedIOHook = (uiohookModule.uIOhook ?? uiohookModule) as IOHook;
    return cachedIOHook;
  } catch {
    throw new Error("Global hotkey support is unavailable. Reinstall the app and try again.");
  }
}

export class HotkeyService {
  private shortcut?: KeyboardShortcut;
  private accelerator?: string;
  private pressed = false;
  private started = false;
  private onPress?: HotkeyCallback;
  private onRelease?: HotkeyCallback;
  private captureCallback?: CaptureCallback;
  private iohook?: IOHook;

  register(shortcut: KeyboardShortcut): void {
    const validationError = validateShortcut(shortcut);
    if (validationError) {
      throw new Error(validationError);
    }

    const accelerator = toElectronAccelerator(shortcut);
    if (!accelerator) {
      throw new Error("That key is not supported for global shortcuts");
    }

    this.ensureHookStarted();

    if (this.accelerator === accelerator) {
      this.shortcut = shortcut;
      this.pressed = false;
      return;
    }

    let registered = false;
    try {
      registered = globalShortcut.register(accelerator, this.handleRegisteredPress);
    } catch {
      throw new Error("Failed to register hotkey. Choose a different shortcut.");
    }

    if (!registered) {
      throw new Error("Hotkey is unavailable. Choose a different shortcut.");
    }

    if (this.accelerator) {
      globalShortcut.unregister(this.accelerator);
    }

    this.accelerator = accelerator;
    this.shortcut = shortcut;
    this.pressed = false;
  }

  setHandlers(onPress: HotkeyCallback, onRelease: HotkeyCallback): void {
    this.onPress = onPress;
    this.onRelease = onRelease;
  }

  unregisterAll(): void {
    if (this.accelerator) {
      globalShortcut.unregister(this.accelerator);
      this.accelerator = undefined;
    }

    if (this.started && this.iohook) {
      this.iohook.removeAllListeners("keydown");
      this.iohook.removeAllListeners("keyup");
      this.iohook.stop();
      this.started = false;
    }

    this.iohook = undefined;
    this.shortcut = undefined;
    this.pressed = false;
    this.captureCallback = undefined;
  }

  beginCapture(onCaptured: CaptureCallback): void {
    this.captureCallback = onCaptured;
    this.ensureHookStarted();
  }

  cancelCapture(): void {
    this.captureCallback = undefined;
  }

  private handleDown = (event: any): void => {
    if (!this.captureCallback) {
      return;
    }

    const captured = this.shortcutFromEvent(event);
    if (captured) {
      const callback = this.captureCallback;
      this.captureCallback = undefined;
      callback(captured);
    }
  };

  private handleUp = (event: any): void => {
    if (!this.shortcut || !this.pressed) {
      return;
    }

    const keyCode = this.readKeyCode(event);
    if (keyCode === undefined) {
      return;
    }

    const modifier = this.modifierForKeyCode(keyCode);
    const releasedRequiredModifier = modifier ? this.shortcut.modifiers.includes(modifier) : false;

    if (keyCode !== this.shortcut.keyCode && !releasedRequiredModifier) {
      return;
    }

    this.pressed = false;
    this.onRelease?.();
  };

  private readKeyCode(event: any): number | undefined {
    if (typeof event.keycode === "number") {
      return event.keycode;
    }
    if (typeof event.rawcode === "number") {
      return event.rawcode;
    }
    return undefined;
  }

  private readModifiers(event: any): Modifier[] {
    const modifiers: Modifier[] = [];
    if (event.metaKey) modifiers.push("cmd");
    if (event.shiftKey) modifiers.push("shift");
    if (event.altKey) modifiers.push("alt");
    if (event.ctrlKey) modifiers.push("ctrl");
    return modifiers;
  }

  private shortcutFromEvent(event: any): KeyboardShortcut | undefined {
    const keyCode = this.readKeyCode(event);
    if (keyCode === undefined) {
      return undefined;
    }

    if (this.isModifierKey(keyCode)) {
      return undefined;
    }

    const modifiers = this.readModifiers(event);
    const shortcut: KeyboardShortcut = {
      keyCode,
      modifiers
    };

    return {
      ...shortcut,
      display: formatShortcut(shortcut)
    };
  }

  private isModifierKey(keyCode: number): boolean {
    const modifierKeyCodes = new Set([29, 42, 54, 56, 3613, 3640, 3675, 3676]);
    return modifierKeyCodes.has(keyCode);
  }

  private modifierForKeyCode(keyCode: number): Modifier | undefined {
    if (keyCode === 29 || keyCode === 3613) {
      return "ctrl";
    }

    if (keyCode === 42 || keyCode === 54) {
      return "shift";
    }

    if (keyCode === 56 || keyCode === 3640) {
      return "alt";
    }

    if (keyCode === 3675 || keyCode === 3676) {
      return "cmd";
    }

    return undefined;
  }

  private handleRegisteredPress = (): void => {
    if (!this.shortcut || this.captureCallback || this.pressed) {
      return;
    }

    this.pressed = true;
    this.onPress?.();
  };

  private ensureHookStarted(): void {
    if (this.started) {
      return;
    }

    this.iohook = loadIOHook();
    this.iohook.on("keydown", this.handleDown);
    this.iohook.on("keyup", this.handleUp);
    this.iohook.start();
    this.started = true;
  }
}
