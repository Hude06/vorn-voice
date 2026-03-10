import { describe, expect, it, vi } from "vitest";
import { AppCoordinator } from "../src/main/coordinator";
import { AppState } from "../src/main/state/appState";
import { AppSettings, DEFAULT_SETTINGS } from "../src/shared/types";
import fs from "node:fs/promises";

vi.mock("node:fs/promises", () => ({
  default: {
    unlink: vi.fn(async () => undefined)
  }
}));

function createHarness(options?: { initialSettings?: AppSettings; autoStart?: boolean }) {
  let onPress: (() => void | Promise<void>) | undefined;
  let onRelease: (() => void | Promise<void>) | undefined;

  const state = new AppState(options?.initialSettings ?? DEFAULT_SETTINGS);
  const store = { save: vi.fn() };
  const hotkey = {
    setHandlers: vi.fn((press: () => void | Promise<void>, release: () => void | Promise<void>) => {
      onPress = press;
      onRelease = release;
    }),
    register: vi.fn(),
    getStatusError: vi.fn(() => undefined),
    warmup: vi.fn(),
    unregisterAll: vi.fn()
  };
  const audioCapture = {
    configureRealtimeCapture: vi.fn(),
    startCapture: vi.fn(async () => undefined),
    stopCapture: vi.fn(async () => "/tmp/sample.wav"),
    prewarmCapture: vi.fn(async () => undefined),
    getLastDiagnostics: vi.fn(() => undefined),
    shutdown: vi.fn(async () => undefined)
  };
  const whisper = {
    transcribe: vi.fn(async () => "hello"),
    ensureRuntimeAvailable: vi.fn(async () => "/tmp/whisper-cli"),
    getLastDiagnostics: vi.fn(() => undefined),
    installRuntime: vi.fn(async () => undefined)
  };
  const modelManager = { resolveModelPath: vi.fn(async () => "/tmp/model.bin") };
  const pasteService = { pasteText: vi.fn(async () => undefined) };
  const permissionService = {
    getMicrophonePermissionStatus: vi.fn(() => "granted"),
    requestMicrophonePermission: vi.fn(async () => true),
    checkAccessibilityPermission: vi.fn(() => true)
  };
  const overlay = {
    show: vi.fn(),
    hide: vi.fn()
  };

  const coordinator = new AppCoordinator(
    state,
    store as any,
    hotkey as any,
    audioCapture as any,
    whisper as any,
    modelManager as any,
    pasteService as any,
    permissionService as any,
    overlay as any
  );

  if (options?.autoStart !== false) {
    coordinator.start();
  }

  return {
    coordinator,
    state,
    store,
    hotkey,
    audioCapture,
    whisper,
    overlay,
    modelManager,
    pasteService,
    permissionService,
    press: async () => {
      onPress?.();
      await waitForCoordinator();
    },
    release: async () => {
      onRelease?.();
      await waitForCoordinator();
    }
  };
}

function waitForCoordinator(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("AppCoordinator error mode behavior", () => {
  it("falls back to the default hotkey when the saved shortcut is unavailable", () => {
    const savedShortcut = {
      keyCode: 20,
      modifiers: ["cmd", "shift"],
      display: "Shift + Command + T"
    } satisfies AppSettings["shortcut"];
    const harness = createHarness({
      initialSettings: {
        ...DEFAULT_SETTINGS,
        shortcut: savedShortcut
      },
      autoStart: false
    });

    harness.hotkey.register.mockImplementation((shortcut: AppSettings["shortcut"]) => {
      if (shortcut.keyCode === savedShortcut.keyCode) {
        throw new Error("Hotkey is unavailable. Choose a different shortcut.");
      }
    });

    const startupIssue = harness.coordinator.start();

    expect(startupIssue).toBe("Saved shortcut was unavailable. Reverted to the default hotkey.");
    expect(harness.hotkey.register).toHaveBeenNthCalledWith(1, savedShortcut);
    expect(harness.hotkey.register).toHaveBeenNthCalledWith(2, DEFAULT_SETTINGS.shortcut);
    expect(harness.store.save).toHaveBeenCalledWith({
      ...DEFAULT_SETTINGS,
      shortcut: DEFAULT_SETTINGS.shortcut
    });
    expect(harness.state.getSnapshot().settings.shortcut).toEqual(DEFAULT_SETTINGS.shortcut);
    expect(harness.state.getSnapshot().mode).toBe("error");
  });

  it("keeps launch alive when no hotkey can be registered", () => {
    const harness = createHarness({ autoStart: false });
    harness.hotkey.register.mockImplementation(() => {
      throw new Error("Hotkey is unavailable. Choose a different shortcut.");
    });

    const startupIssue = harness.coordinator.start();

    expect(startupIssue).toBe("Hotkey is unavailable. Choose a different shortcut.");
    expect(harness.state.getSnapshot().mode).toBe("error");
    expect(harness.store.save).not.toHaveBeenCalled();
  });

  it("cleans up recorded audio after successful transcription", async () => {
    const harness = createHarness();

    await harness.press();
    await harness.release();

    expect(fs.unlink).toHaveBeenCalledWith("/tmp/sample.wav");
  });

  it("cleans up recorded audio after transcription failure", async () => {
    const harness = createHarness();
    harness.whisper.transcribe.mockRejectedValue(new Error("Transcription failed"));

    await harness.press();
    await harness.release();

    expect(fs.unlink).toHaveBeenCalledWith("/tmp/sample.wav");
  });

  it("keeps idle mode for no-speech stop errors", async () => {
    const harness = createHarness();
    harness.audioCapture.stopCapture.mockRejectedValue(new Error("No speech detected"));

    await harness.press();
    await harness.release();

    const snapshot = harness.state.getSnapshot();
    expect(snapshot.mode).toBe("idle");
    expect(snapshot.errorMessage).toBe("No speech detected");
    expect(harness.overlay.show).toHaveBeenCalledWith("message", "No speech detected");
  });

  it("keeps idle mode for no-speech transcription errors", async () => {
    const harness = createHarness();
    harness.whisper.transcribe.mockRejectedValue(new Error("No speech detected"));

    await harness.press();
    await harness.release();

    const snapshot = harness.state.getSnapshot();
    expect(snapshot.mode).toBe("idle");
    expect(snapshot.errorMessage).toBe("No speech detected");
    expect(harness.overlay.show).toHaveBeenCalledWith("message", "No speech detected");
  });

  it("keeps idle mode for quiet-input errors", async () => {
    const harness = createHarness();
    harness.audioCapture.stopCapture.mockRejectedValue(new Error("Input too quiet. Move closer to the mic or speak a little louder."));

    await harness.press();
    await harness.release();

    const snapshot = harness.state.getSnapshot();
    expect(snapshot.mode).toBe("idle");
    expect(snapshot.errorMessage).toBe("Input too quiet. Move closer to the mic or speak a little louder.");
    expect(harness.overlay.show).toHaveBeenCalledWith("message", "Input too quiet. Move closer to the mic or speak a little louder.");
  });

  it("keeps hard failures in error mode", async () => {
    const harness = createHarness();
    harness.audioCapture.stopCapture.mockRejectedValue(new Error("Audio capture failed: recorder crashed"));

    await harness.press();
    await harness.release();

    const snapshot = harness.state.getSnapshot();
    expect(snapshot.mode).toBe("error");
    expect(snapshot.errorMessage).toBe("Audio capture failed: recorder crashed");
    expect(harness.overlay.show).toHaveBeenCalledWith("message", "Audio capture failed: recorder crashed");
  });

  it("shows the missing runtime message during transcription failures", async () => {
    const harness = createHarness();
    harness.whisper.ensureRuntimeAvailable.mockRejectedValue(
      new Error("whisper-cli not found. Install the Whisper runtime from Settings.")
    );

    await harness.press();
    await harness.release();

    const snapshot = harness.state.getSnapshot();
    expect(snapshot.mode).toBe("error");
    expect(snapshot.errorMessage).toBe("whisper-cli not found. Install the Whisper runtime from Settings.");
    expect(harness.overlay.show).toHaveBeenCalledWith(
      "message",
      "whisper-cli not found. Install the Whisper runtime from Settings."
    );
  });

  it("shows the missing model message during transcription failures", async () => {
    const harness = createHarness();
    harness.modelManager.resolveModelPath.mockRejectedValue(new Error("Model is not installed"));

    await harness.press();
    await harness.release();

    const snapshot = harness.state.getSnapshot();
    expect(snapshot.mode).toBe("error");
    expect(snapshot.errorMessage).toBe("Model is not installed");
    expect(harness.overlay.show).toHaveBeenCalledWith("message", "Model is not installed");
  });

  it("shows the accessibility message when paste automation cannot run", async () => {
    const harness = createHarness({
      initialSettings: {
        ...DEFAULT_SETTINGS,
        autoPaste: true
      }
    });
    harness.permissionService.checkAccessibilityPermission.mockReturnValue(false);

    await harness.press();
    await harness.release();

    const snapshot = harness.state.getSnapshot();
    expect(snapshot.mode).toBe("error");
    expect(snapshot.errorMessage).toBe("Accessibility permission is required for paste automation");
    expect(harness.overlay.show).toHaveBeenCalledWith(
      "message",
      "Accessibility permission is required for paste automation"
    );
  });

  it("shows transcribed messaging when auto-paste is disabled", async () => {
    const harness = createHarness();
    harness.state.setSettings({
      ...DEFAULT_SETTINGS,
      autoPaste: false
    });

    await harness.press();
    await harness.release();

    expect(harness.pasteService.pasteText).not.toHaveBeenCalled();
    expect(harness.overlay.show).toHaveBeenCalledWith("message", "Transcribed");
  });

  it("stores only a preview for long transcripts in app state", async () => {
    const harness = createHarness();
    harness.whisper.transcribe.mockResolvedValue(`${"word ".repeat(120)}tail`);

    await harness.press();
    await harness.release();

    const snapshot = harness.state.getSnapshot();
    expect(snapshot.lastTranscriptWordCount).toBeGreaterThan(100);
    expect(snapshot.lastTranscriptPreview.length).toBeLessThanOrEqual(280);
    expect(snapshot.lastTranscriptTruncated).toBe(true);
  });

  it("runs onboarding dictation tests without auto-paste and returns transcript details", async () => {
    const harness = createHarness({
      initialSettings: {
        ...DEFAULT_SETTINGS,
        autoPaste: true
      }
    });
    harness.permissionService.checkAccessibilityPermission.mockReturnValue(false);

    await harness.coordinator.startOnboardingDictationTest();
    const result = await harness.coordinator.finishOnboardingDictationTest();

    expect(result).toEqual({
      transcript: "hello",
      wordCount: 1,
      durationMs: expect.any(Number),
      modelId: DEFAULT_SETTINGS.activeModelId,
      autoPasteEnabled: true,
      accessibilityReady: false
    });
    expect(harness.pasteService.pasteText).not.toHaveBeenCalled();
    expect(harness.overlay.show).toHaveBeenCalledWith("message", "Test complete");
  });

  it("surfaces microphone permission errors during onboarding test start", async () => {
    const harness = createHarness();
    harness.permissionService.getMicrophonePermissionStatus.mockReturnValue("denied");
    harness.permissionService.requestMicrophonePermission.mockResolvedValue(false);

    await expect(harness.coordinator.startOnboardingDictationTest()).rejects.toThrow("Microphone permission is required");
    expect(harness.audioCapture.startCapture).not.toHaveBeenCalled();
  });

  it("toggles recording on repeated hotkey presses", async () => {
    const harness = createHarness({
      initialSettings: {
        ...DEFAULT_SETTINGS,
        hotkeyBehavior: "toggle"
      }
    });

    await harness.press();
    await harness.release();

    expect(harness.audioCapture.stopCapture).not.toHaveBeenCalled();

    await harness.press();

    expect(harness.audioCapture.stopCapture).toHaveBeenCalledTimes(1);
    expect(harness.whisper.transcribe).toHaveBeenCalledTimes(1);
  });

  it("handles release while capture startup is still in flight", async () => {
    const harness = createHarness();

    let resolveStart: () => void = () => undefined;
    const startPromise = new Promise<undefined>((resolve) => {
      resolveStart = () => resolve(undefined);
    });
    harness.audioCapture.startCapture.mockImplementation(() => startPromise);

    const pressPromise = harness.press();
    await waitForCoordinator();
    const releasePromise = harness.release();

    resolveStart();
    await pressPromise;
    await releasePromise;
    await waitForCoordinator();

    expect(harness.audioCapture.stopCapture).toHaveBeenCalledTimes(1);
    expect(harness.whisper.transcribe).toHaveBeenCalledTimes(1);
  });

  it("does not start capture when release happens during microphone permission request", async () => {
    const harness = createHarness();
    harness.permissionService.getMicrophonePermissionStatus.mockReturnValue("not-determined");

    let resolvePermission: (allowed: boolean) => void = () => undefined;
    const permissionPromise = new Promise<boolean>((resolve) => {
      resolvePermission = resolve;
    });
    harness.permissionService.requestMicrophonePermission.mockImplementation(() => permissionPromise);

    await harness.press();
    await waitForCoordinator();
    await harness.release();

    resolvePermission(true);
    await waitForCoordinator();

    expect(harness.audioCapture.startCapture).not.toHaveBeenCalled();
    expect(harness.audioCapture.stopCapture).not.toHaveBeenCalled();
    expect(harness.whisper.transcribe).not.toHaveBeenCalled();
  });

  it("stops after startup when toggle mode receives a second press", async () => {
    const harness = createHarness({
      initialSettings: {
        ...DEFAULT_SETTINGS,
        hotkeyBehavior: "toggle"
      }
    });

    let resolveStart: () => void = () => undefined;
    const startPromise = new Promise<undefined>((resolve) => {
      resolveStart = () => resolve(undefined);
    });
    harness.audioCapture.startCapture.mockImplementation(() => startPromise);

    const firstPressPromise = harness.press();
    await waitForCoordinator();
    const secondPressPromise = harness.press();

    resolveStart();
    await firstPressPromise;
    await secondPressPromise;
    await waitForCoordinator();

    expect(harness.audioCapture.stopCapture).toHaveBeenCalledTimes(1);
    expect(harness.whisper.transcribe).toHaveBeenCalledTimes(1);
  });
});
