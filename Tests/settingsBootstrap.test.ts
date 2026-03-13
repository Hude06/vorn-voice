import { describe, expect, it, vi } from "vitest";
import { loadOptionalSettingsData } from "../src/renderer/settings/SettingsApp";
import { DEFAULT_SETTINGS } from "../src/shared/types";

describe("settings bootstrap helpers", () => {
  it("falls back gracefully when non-critical bootstrap calls fail", async () => {
    const voicebar = {
      getOnboardingVerificationState: vi.fn(async () => {
        throw new Error("verification unavailable");
      }),
      getAppVersion: vi.fn(async () => {
        throw new Error("version unavailable");
      }),
      getUpdateState: vi.fn(async () => {
        throw new Error("updates unavailable");
      }),
      getSpeechStats: vi.fn(async () => {
        throw new Error("stats unavailable");
      }),
      checkPermissions: vi.fn(async () => {
        throw new Error("permissions unavailable");
      }),
      getSpeechRuntimeDiagnostics: vi.fn(async () => {
        throw new Error("runtime unavailable");
      })
    } as any;

    const optional = await loadOptionalSettingsData(voicebar, DEFAULT_SETTINGS);

    expect(optional.onboardingVerification).toEqual({
      status: "idle",
      hotkeyBehavior: DEFAULT_SETTINGS.hotkeyBehavior,
      shortcut: DEFAULT_SETTINGS.shortcut
    });
    expect(optional.appVersion).toBe("Unknown");
    expect(optional.updateState).toBeNull();
    expect(optional.speechStats.totalWords).toBe(0);
    expect(optional.support.errors).toHaveLength(2);
    expect(optional.warnings).toContain("verification unavailable");
  });
});
