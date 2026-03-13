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

type PersistedReadResult = {
  payload: PersistedSettings;
  status: "ok" | "missing" | "blocked";
  errorMessage?: string;
};

export class SettingsStore {
  private filePath = path.join(app.getPath("userData"), "settings.json");
  private writeBlockedReason: string | null = null;

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
    this.assertWritable();
    this.writePersisted({
      settings,
      onboarding: this.normalizeOnboarding(persisted.onboarding),
      ui: persisted.ui
    });
  }

  updateOnboarding(partial?: Partial<OnboardingState>): OnboardingState {
    const persisted = this.readPersisted();
    this.assertWritable();
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
    this.assertWritable();
    this.writePersisted({
      settings: this.normalizeSettings(persisted.settings),
      onboarding: next,
      ui: persisted.ui
    });

    return next;
  }

  resetOnboarding(): OnboardingState {
    const persisted = this.readPersisted();
    this.assertWritable();
    const reset = { ...DEFAULT_ONBOARDING_STATE };
    this.writePersisted({
      settings: this.normalizeSettings(persisted.settings),
      onboarding: reset,
      ui: persisted.ui
    });
    return reset;
  }

  private readPersisted(): PersistedSettings {
    const result = this.readPersistedState();
    this.writeBlockedReason = result.status === "blocked" ? result.errorMessage ?? "Settings storage is unavailable." : null;
    return result.payload;
  }

  private readPersistedState(): PersistedReadResult {
    try {
      return {
        payload: this.readPersistedFile(this.filePath),
        status: "ok"
      };
    } catch (error) {
      if (!isMissingFileError(error)) {
        return {
          payload: {
            settings: DEFAULT_SETTINGS,
            onboarding: DEFAULT_ONBOARDING_STATE
          },
          status: "blocked",
          errorMessage: "Could not read existing settings safely. Fix or remove settings.json before saving changes."
        };
      }
    }

    for (const legacyPath of this.legacyFilePaths()) {
      try {
        const payload = this.readPersistedFile(legacyPath);
        this.writePersisted(payload);
        return {
          payload,
          status: "ok"
        };
      } catch (error) {
        if (!isMissingFileError(error)) {
          return {
            payload: {
              settings: DEFAULT_SETTINGS,
              onboarding: DEFAULT_ONBOARDING_STATE
            },
            status: "blocked",
            errorMessage: `Could not migrate existing settings from ${path.basename(path.dirname(legacyPath))}. Fix or remove the old settings file before saving changes.`
          };
        }
      }
    }

    return {
      payload: {
        settings: DEFAULT_SETTINGS,
        onboarding: DEFAULT_ONBOARDING_STATE
      },
      status: "missing"
    };
  }

  private readPersistedFile(filePath: string): PersistedSettings {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
    return {
      settings: parsed.settings ?? DEFAULT_SETTINGS,
      onboarding: parsed.onboarding,
      ui: parsed.ui
    };
  }

  private writePersisted(payload: PersistedSettings): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(payload, null, 2), "utf8");
  }

  private legacyFilePaths(): string[] {
    const appDataPath = app.getPath("appData");
    return [
      path.join(appDataPath, "voicebar", "settings.json"),
      path.join(appDataPath, "Voicebar", "settings.json")
    ];
  }

  private assertWritable(): void {
    if (!this.writeBlockedReason) {
      return;
    }

    throw new Error(this.writeBlockedReason);
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
        verifiedHotkeyBehavior: undefined,
        verifiedShortcut: undefined,
        version: ONBOARDING_VERSION,
        completedAt: undefined
      };
    }

    if (!normalized.dictationVerified) {
      normalized.dictationVerifiedAt = undefined;
      normalized.verifiedModelId = undefined;
      normalized.verifiedHotkeyBehavior = undefined;
      normalized.verifiedShortcut = undefined;
    }

    return normalized;
  }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (error as { code?: string }).code === "ENOENT"
  );
}

function clampCaptureWindow(value: number, minimum: number, maximum: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}
