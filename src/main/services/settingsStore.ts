import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import {
  AppSettings,
  DEFAULT_ONBOARDING_STATE,
  DEFAULT_SETTINGS,
  OnboardingState,
  SettingsWindowMode,
  ONBOARDING_VERSION
} from "../../shared/types";
import { formatShortcut, validateShortcut } from "../../shared/shortcuts";

type PersistedSettings = {
  settings: AppSettings;
  onboarding?: OnboardingState;
  ui?: {
    hasSeenPostOnboardingWindow?: boolean;
  };
};

export class SettingsStore {
  private filePath = path.join(app.getPath("userData"), "settings.json");

  load(): AppSettings {
    const persisted = this.readPersisted();
    return this.normalizeSettings(persisted.settings);
  }

  loadOnboarding(): OnboardingState {
    const persisted = this.readPersisted();
    return this.normalizeOnboarding(persisted.onboarding);
  }

  shouldShowOnboarding(): boolean {
    const onboarding = this.loadOnboarding();
    return !onboarding.completed || onboarding.version < ONBOARDING_VERSION;
  }

  resolveSettingsWindowMode(requested?: SettingsWindowMode): SettingsWindowMode {
    if (this.shouldShowOnboarding()) {
      return "onboarding";
    }

    return requested ?? "settings";
  }

  shouldOpenWindowOnLaunch(): boolean {
    if (this.shouldShowOnboarding()) {
      return true;
    }

    const persisted = this.readPersisted();
    return !persisted.ui?.hasSeenPostOnboardingWindow;
  }

  markPostOnboardingWindowSeen(): void {
    const persisted = this.readPersisted();
    this.writePersisted({
      settings: this.normalizeSettings(persisted.settings),
      onboarding: this.normalizeOnboarding(persisted.onboarding),
      ui: {
        ...persisted.ui,
        hasSeenPostOnboardingWindow: true
      }
    });
  }

  save(settings: AppSettings): void {
    const persisted = this.readPersisted();
    this.writePersisted({
      settings,
      onboarding: this.normalizeOnboarding(persisted.onboarding),
      ui: persisted.ui
    });
  }

  updateOnboarding(partial?: Partial<OnboardingState>): OnboardingState {
    const persisted = this.readPersisted();
    const next = this.normalizeOnboarding({
      ...this.normalizeOnboarding(persisted.onboarding),
      ...partial
    });

    this.writePersisted({
      settings: this.normalizeSettings(persisted.settings),
      onboarding: next,
      ui: persisted.ui
    });

    return next;
  }

  completeOnboarding(partial?: Partial<OnboardingState>): OnboardingState {
    const current = this.loadOnboarding();
    const next: OnboardingState = {
      ...current,
      ...partial,
      completed: true,
      version: ONBOARDING_VERSION,
      completedAt: Date.now()
    };

    const persisted = this.readPersisted();
    this.writePersisted({
      settings: this.normalizeSettings(persisted.settings),
      onboarding: next,
      ui: persisted.ui
    });

    return next;
  }

  resetOnboarding(): OnboardingState {
    const persisted = this.readPersisted();
    const reset = { ...DEFAULT_ONBOARDING_STATE };
    this.writePersisted({
      settings: this.normalizeSettings(persisted.settings),
      onboarding: reset,
      ui: persisted.ui
    });
    return reset;
  }

  private readPersisted(): PersistedSettings {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
      return {
        settings: parsed.settings ?? DEFAULT_SETTINGS,
        onboarding: parsed.onboarding,
        ui: parsed.ui
      };
    } catch {
      return {
        settings: DEFAULT_SETTINGS,
        onboarding: DEFAULT_ONBOARDING_STATE
      };
    }
  }

  private writePersisted(payload: PersistedSettings): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(payload, null, 2), "utf8");
  }

  private normalizeSettings(settings: AppSettings): AppSettings {
    const merged = {
      ...DEFAULT_SETTINGS,
      ...settings,
      shortcut: {
        ...DEFAULT_SETTINGS.shortcut,
        ...settings.shortcut
      }
    };

    const validationError = validateShortcut(merged.shortcut);
    if (validationError) {
      return {
        ...merged,
        shortcut: {
          ...DEFAULT_SETTINGS.shortcut,
          display: formatShortcut(DEFAULT_SETTINGS.shortcut)
        }
      };
    }

    return {
      ...merged,
      preRollMs: clampCaptureWindow(merged.preRollMs, 0, 1200, DEFAULT_SETTINGS.preRollMs),
      postRollMs: clampCaptureWindow(merged.postRollMs, 0, 1200, DEFAULT_SETTINGS.postRollMs),
      shortcut: {
        ...merged.shortcut,
        display: formatShortcut(merged.shortcut)
      }
    };
  }

  private normalizeOnboarding(onboarding?: OnboardingState): OnboardingState {
    const { selectedModelId: _selectedModelId, ...persistedOnboarding } = (onboarding ?? {}) as OnboardingState & { selectedModelId?: string };
    const normalized: OnboardingState = {
      ...DEFAULT_ONBOARDING_STATE,
      ...persistedOnboarding,
      version: onboarding?.version ?? ONBOARDING_VERSION
    };

    if (normalized.version < ONBOARDING_VERSION) {
      return {
        ...normalized,
        completed: false,
        dictationVerified: false,
        dictationVerifiedAt: undefined,
        verifiedModelId: undefined,
        verifiedShortcut: undefined,
        version: ONBOARDING_VERSION,
        completedAt: undefined
      };
    }

    if (!normalized.dictationVerified) {
      normalized.dictationVerifiedAt = undefined;
      normalized.verifiedModelId = undefined;
      normalized.verifiedShortcut = undefined;
    }

    return normalized;
  }
}

function clampCaptureWindow(value: number, minimum: number, maximum: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}
