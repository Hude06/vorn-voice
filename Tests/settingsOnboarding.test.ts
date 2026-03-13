import { describe, expect, it } from "vitest";
import { DEFAULT_ONBOARDING_STATE, DEFAULT_SETTINGS, type OnboardingVerificationState } from "../src/shared/types";
import {
  didOnboardingVerificationInputsChange,
  getResidentShellCopy,
  isOverviewReady,
  isLiveOnboardingVerified,
  isPersistedOnboardingVerified,
  mergeOnboardingVerificationBootstrapState,
  resolveModelRemovalFollowUp,
  resolvedVerifiedHotkeyBehavior,
  resolvedVerifiedModelId,
  resolvedVerifiedShortcut
} from "../src/renderer/settings/SettingsApp";

describe("settings onboarding verification helpers", () => {
  it("treats a passed live verification as enough to finish setup before onboarding state is persisted", () => {
    const verification: OnboardingVerificationState = {
      status: "passed",
      hotkeyBehavior: DEFAULT_SETTINGS.hotkeyBehavior,
      shortcut: DEFAULT_SETTINGS.shortcut,
      result: {
        transcript: "hello world",
        wordCount: 2,
        durationMs: 1200,
        modelId: DEFAULT_SETTINGS.activeModelId,
        autoPasteEnabled: false,
        autoPasteAccessReady: true
      }
    };

    expect(isPersistedOnboardingVerified(DEFAULT_ONBOARDING_STATE, DEFAULT_SETTINGS)).toBe(false);
    expect(isLiveOnboardingVerified(verification, DEFAULT_SETTINGS)).toBe(true);
    expect(resolvedVerifiedModelId(verification, DEFAULT_SETTINGS)).toBe(DEFAULT_SETTINGS.activeModelId);
    expect(resolvedVerifiedHotkeyBehavior(verification, DEFAULT_SETTINGS)).toBe(DEFAULT_SETTINGS.hotkeyBehavior);
    expect(resolvedVerifiedShortcut(verification, DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS.shortcut);
  });

  it("rejects a passed verification when the verified shortcut no longer matches the current draft", () => {
    const verification: OnboardingVerificationState = {
      status: "passed",
      hotkeyBehavior: DEFAULT_SETTINGS.hotkeyBehavior,
      shortcut: DEFAULT_SETTINGS.shortcut,
      result: {
        transcript: "hello world",
        wordCount: 2,
        durationMs: 1200,
        modelId: DEFAULT_SETTINGS.activeModelId,
        autoPasteEnabled: false,
        autoPasteAccessReady: true
      }
    };

    const changedDraft = {
      ...DEFAULT_SETTINGS,
      shortcut: {
        keyCode: 5,
        modifiers: ["cmd"],
        display: "Command + G"
      }
    };

    expect(isLiveOnboardingVerified(verification, changedDraft)).toBe(false);
  });

  it("treats a hotkey behavior change as a verification reset input", () => {
    expect(didOnboardingVerificationInputsChange(DEFAULT_SETTINGS, {
      ...DEFAULT_SETTINGS,
      hotkeyBehavior: "toggle"
    })).toBe(true);
  });

  it("preserves an active onboarding verification session over stale bootstrap state", () => {
    const current: OnboardingVerificationState = {
      status: "transcribing",
      hotkeyBehavior: DEFAULT_SETTINGS.hotkeyBehavior,
      shortcut: DEFAULT_SETTINGS.shortcut
    };
    const incoming: OnboardingVerificationState = {
      status: "idle",
      hotkeyBehavior: DEFAULT_SETTINGS.hotkeyBehavior,
      shortcut: DEFAULT_SETTINGS.shortcut
    };

    expect(mergeOnboardingVerificationBootstrapState(current, incoming)).toEqual(current);
  });

  it("uses platform-aware resident shell copy", () => {
    expect(getResidentShellCopy("macos")).toEqual({
      intro: "Work through the essentials once, then Vorn can stay quietly in your menu bar.",
      reopenHint: "After this, Vorn can stay in your menu bar. If anything stops working, you can reopen this window from the menu bar icon."
    });
    expect(getResidentShellCopy("windows")).toEqual({
      intro: "Work through the essentials once, then Vorn can stay quietly in your system tray.",
      reopenHint: "After this, Vorn can stay in your system tray. If anything stops working, you can reopen this window from the tray icon."
    });
  });

  it("treats overview readiness as blocked when hotkey monitoring is unavailable", () => {
    expect(isOverviewReady({
      activeModelInstalled: true,
      runtimeReady: true,
      microphoneGranted: true,
      pasteReady: true,
      hotkeyReady: false
    })).toBe(false);
  });

  it("preserves requestSave status when removing the active model with a fallback", () => {
    expect(resolveModelRemovalFollowUp({
      removedModelId: DEFAULT_SETTINGS.activeModelId,
      activeModelId: DEFAULT_SETTINGS.activeModelId,
      installedFallbackId: "tiny.en"
    })).toBe("preserve-existing-status");
  });

  it("warns when removing the active model without a fallback", () => {
    expect(resolveModelRemovalFollowUp({
      removedModelId: DEFAULT_SETTINGS.activeModelId,
      activeModelId: DEFAULT_SETTINGS.activeModelId
    })).toBe("warn-no-fallback");
  });
});
