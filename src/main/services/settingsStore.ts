import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import {
  AppSettings,
  DEFAULT_ONBOARDING_STATE,
  DEFAULT_SETTINGS,
  OnboardingState,
  ONBOARDING_VERSION
} from "../../shared/types";
import { formatShortcut, validateShortcut } from "../../shared/shortcuts";

type PersistedSettings = {
  settings: AppSettings;
  onboarding?: OnboardingState;
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

  save(settings: AppSettings): void {
    const persisted = this.readPersisted();
    this.writePersisted({
      settings,
      onboarding: this.normalizeOnboarding(persisted.onboarding)
    });
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
      onboarding: next
    });

    return next;
  }

  resetOnboarding(): OnboardingState {
    const persisted = this.readPersisted();
    const reset = { ...DEFAULT_ONBOARDING_STATE };
    this.writePersisted({
      settings: this.normalizeSettings(persisted.settings),
      onboarding: reset
    });
    return reset;
  }

  private readPersisted(): PersistedSettings {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
      return {
        settings: parsed.settings ?? DEFAULT_SETTINGS,
        onboarding: parsed.onboarding
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
      shortcut: {
        ...merged.shortcut,
        display: formatShortcut(merged.shortcut)
      }
    };
  }

  private normalizeOnboarding(onboarding?: OnboardingState): OnboardingState {
    const normalized = {
      ...DEFAULT_ONBOARDING_STATE,
      ...onboarding,
      version: onboarding?.version ?? ONBOARDING_VERSION
    };

    if (normalized.version < ONBOARDING_VERSION) {
      return {
        ...normalized,
        completed: false,
        version: ONBOARDING_VERSION,
        completedAt: undefined
      };
    }

    return normalized;
  }
}
