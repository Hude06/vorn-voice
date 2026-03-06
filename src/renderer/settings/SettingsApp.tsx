import { useEffect, useMemo, useRef, useState } from "react";
import { formatShortcut, validateShortcut } from "../../shared/shortcuts";
import {
  AppSettings,
  AppSnapshot,
  DEFAULT_ONBOARDING_STATE,
  DEFAULT_SETTINGS,
  OnboardingState,
  SettingsWindowMode,
  SpeechRuntimeDiagnostics,
  SpeechSample
} from "../../shared/types";
import {
  applySpeechSample,
  averageWpm,
  parseSpeechStats,
  SPEECH_STATS_STORAGE_KEY,
  SpeechStats,
  wordsThisWeek
} from "../../shared/speechStats";

type ModelRow = {
  id: string;
  name: string;
  details: string;
  installed: boolean;
};

type VoicebarApi = NonNullable<Window["voicebar"]>;
type SectionId = "overview" | "hotkey" | "models" | "runtime" | "permissions" | "paste" | "updates" | "diagnostics";
type ThemePreference = "system" | "light" | "dark";
type StatusTone = "neutral" | "success" | "warning" | "danger";
type SectionMeta = { id: SectionId; label: string; description: string };
type StatusMessage = { tone: StatusTone; text: string };
type HealthTone = "ready" | "attention" | "pending";

const SETTINGS_SECTIONS: SectionMeta[] = [
  { id: "overview", label: "Overview", description: "Readiness and workflow" },
  { id: "hotkey", label: "Hotkey", description: "Push-to-talk controls" },
  { id: "models", label: "Models", description: "Local model management" },
  { id: "runtime", label: "Runtime", description: "Engine diagnostics" },
  { id: "permissions", label: "Permissions", description: "macOS access" },
  { id: "paste", label: "Paste", description: "Clipboard behavior" },
  { id: "updates", label: "Updates", description: "Automatic updates" },
  { id: "diagnostics", label: "Diagnostics", description: "Speech insights" }
];

const ONBOARDING_STEPS = ["Welcome", "Pick Model", "Runtime & Permissions", "Hotkey", "Finish"];
const CRITICAL_IPC_TIMEOUT_MS = 5000;
const NON_CRITICAL_IPC_TIMEOUT_MS = 4500;
const FALLBACK_SNAPSHOT: AppSnapshot = {
  mode: "idle",
  lastTranscriptPreview: "",
  lastTranscriptWordCount: 0,
  lastTranscriptTruncated: false,
  settings: DEFAULT_SETTINGS
};
const PRELOAD_ERROR_MESSAGE = "Bridge unavailable. Restart Vorn Voice to reload the settings window.";
const THEME_STORAGE_KEY = "voicebar.ui.theme.v1";

export function SettingsApp() {
  const [windowMode, setWindowMode] = useState<SettingsWindowMode>(parseWindowMode());
  const [activeSection, setActiveSection] = useState<SectionId>("overview");
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboarding, setOnboarding] = useState<OnboardingState>(DEFAULT_ONBOARDING_STATE);
  const [draft, setDraft] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [recordingHotkey, setRecordingHotkey] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCompletingOnboarding, setIsCompletingOnboarding] = useState(false);
  const [status, setStatus] = useState<StatusMessage>({ tone: "neutral", text: "Loading workspace..." });
  const [accessibilityGranted, setAccessibilityGranted] = useState<boolean | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [speechRuntime, setSpeechRuntime] = useState<SpeechRuntimeDiagnostics | null>(null);
  const [isInstallingRuntime, setIsInstallingRuntime] = useState(false);
  const [speechStats, setSpeechStats] = useState<SpeechStats>(() => loadSpeechStats());
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => loadThemePreference());

  const isDirtyRef = useRef(false);
  const recordingRef = useRef(false);
  const voicebar = getVoicebarApi();

  const resolvedTheme = useMemo<"light" | "dark">(() => {
    if (themePreference === "light" || themePreference === "dark") {
      return themePreference;
    }

    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }, [themePreference]);

  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  useEffect(() => {
    recordingRef.current = recordingHotkey;
  }, [recordingHotkey]);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => {
    if (!voicebar) {
      updateStatus(setStatus, PRELOAD_ERROR_MESSAGE, "danger");
      return;
    }

    let mounted = true;

    const bootstrap = async () => {
      const [criticalResult, onboardingResult] = await Promise.allSettled([
        loadCriticalSettingsData(voicebar),
        withTimeout(voicebar.getOnboardingState(), CRITICAL_IPC_TIMEOUT_MS, "Onboarding state")
      ]);

      if (!mounted) {
        return;
      }

      const warnings: string[] = [];

      if (criticalResult.status === "fulfilled") {
        setDraft(criticalResult.value.snapshot.settings);
        setModels(criticalResult.value.listedModels);
        warnings.push(...criticalResult.value.warnings);
        applySampleToStats(criticalResult.value.snapshot.lastSpeechSample, setSpeechStats);
      } else {
        warnings.push(`Settings load failed: ${errorToMessage(criticalResult.reason)}`);
        setDraft(FALLBACK_SNAPSHOT.settings);
      }

      if (onboardingResult.status === "fulfilled") {
        setOnboarding(onboardingResult.value);
      } else {
        warnings.push(`Onboarding load failed: ${errorToMessage(onboardingResult.reason)}`);
      }

      updateStatus(setStatus, warnings.length > 0 ? `Loaded with warnings: ${warnings.join("; ")}` : "Workspace ready", warnings.length > 0 ? "warning" : "success");

      void loadNonCriticalSettingsData(voicebar).then((result) => {
        if (!mounted) {
          return;
        }

        if (result.permission) {
          setAccessibilityGranted(result.permission.accessibility);
        }

        if (result.runtime) {
          setSpeechRuntime(result.runtime);
        }

        if (result.errors.length > 0) {
          updateStatus(setStatus, `Loaded with warnings: ${result.errors.join("; ")}`, "warning");
        }
      });
    };

    void bootstrap();

    const unsubState = voicebar.onStateChanged((snapshot) => {
      if (!mounted) {
        return;
      }

      if (!isDirtyRef.current) {
        setDraft(snapshot.settings);
      }

      if (snapshot.errorMessage) {
        updateStatus(setStatus, snapshot.errorMessage, "danger");
      }

      applySampleToStats(snapshot.lastSpeechSample, setSpeechStats);
    });

    const unsubHotkey = voicebar.onHotkeyCaptured((shortcut) => {
      if (!mounted || !recordingRef.current) {
        return;
      }

      setRecordingHotkey(false);
      const validationError = validateShortcut(shortcut);
      if (validationError) {
        updateStatus(setStatus, validationError, "danger");
        return;
      }

      setDraft((prev) => ({ ...prev, shortcut }));
      setIsDirty(true);
      updateStatus(setStatus, `Hotkey set to ${formatShortcut(shortcut)}. Save to apply.`, "success");
    });

    const unsubProgress = voicebar.onModelDownloadProgress(({ modelId, percent }) => {
      if (!mounted) {
        return;
      }

      setDownloadProgress((prev) => ({ ...prev, [modelId]: percent }));
    });

    return () => {
      mounted = false;
      unsubState();
      unsubHotkey();
      unsubProgress();

      if (recordingRef.current) {
        void voicebar.cancelHotkeyCapture();
      }
    };
  }, [voicebar]);

  const activeModelInstalled = useMemo(
    () => models.some((model) => model.id === draft.activeModelId && model.installed),
    [models, draft.activeModelId]
  );
  const installedModels = useMemo(() => models.filter((model) => model.installed), [models]);
  const averageSpeechWpm = useMemo(() => averageWpm(speechStats), [speechStats]);
  const weeklyWords = useMemo(() => wordsThisWeek(speechStats), [speechStats]);
  const runtimeReady = Boolean(speechRuntime?.whisperCliFound);
  const permissionsReady = accessibilityGranted === true;
  const installedModelCount = installedModels.length;
  const readinessChecks = [
    onboarding.completed,
    runtimeReady,
    permissionsReady,
    installedModelCount > 0,
    activeModelInstalled
  ];
  const readinessScore = readinessChecks.filter(Boolean).length;
  const readinessRatio = Math.round((readinessScore / readinessChecks.length) * 100);
  const inOnboarding = windowMode === "onboarding";
  const onboardingLastStep = ONBOARDING_STEPS.length - 1;
  const currentSection = SETTINGS_SECTIONS.find((section) => section.id === activeSection) ?? SETTINGS_SECTIONS[0];
  const focusStatus = buildFocusStatus({
    inOnboarding,
    status,
    isDirty,
    runtimeReady,
    permissionsReady,
    installedModelCount,
    activeModelInstalled,
    recordingHotkey
  });

  const saveDraft = async () => {
    if (!voicebar) {
      updateStatus(setStatus, PRELOAD_ERROR_MESSAGE, "danger");
      return false;
    }

    setIsSaving(true);
    try {
      if (!activeModelInstalled && models.length > 0) {
        throw new Error("Select an installed model before saving");
      }

      if (recordingRef.current) {
        await voicebar.cancelHotkeyCapture();
        setRecordingHotkey(false);
      }

      const updated = await withTimeout(voicebar.saveSettings(draft), CRITICAL_IPC_TIMEOUT_MS, "Save settings");
      setDraft(updated.settings);
      setIsDirty(false);
      updateStatus(setStatus, "Settings saved", "success");
      return true;
    } catch (error) {
      updateStatus(setStatus, `Save failed: ${errorToMessage(error)}`, "danger");
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const toggleCapture = async () => {
    if (!voicebar) {
      updateStatus(setStatus, PRELOAD_ERROR_MESSAGE, "danger");
      return;
    }

    if (recordingRef.current) {
      await voicebar.cancelHotkeyCapture();
      setRecordingHotkey(false);
      updateStatus(setStatus, "Hotkey capture cancelled", "neutral");
      return;
    }

    setRecordingHotkey(true);
    updateStatus(setStatus, "Press your new shortcut now", "neutral");

    try {
      await voicebar.startHotkeyCapture();
    } catch (error) {
      setRecordingHotkey(false);
      updateStatus(setStatus, `Hotkey capture failed: ${errorToMessage(error)}`, "danger");
    }
  };

  const downloadModel = async (modelId: string, name: string) => {
    if (!voicebar) {
      updateStatus(setStatus, PRELOAD_ERROR_MESSAGE, "danger");
      return;
    }

    setDownloadProgress((prev) => ({ ...prev, [modelId]: 0 }));

    try {
      await voicebar.downloadModel(modelId);
      const listedModels = await voicebar.listModels();
      setModels(listedModels);
      updateStatus(setStatus, `${name} is ready to use`, "success");
      setDownloadProgress((prev) => ({ ...prev, [modelId]: 100 }));
    } catch (error) {
      updateStatus(setStatus, `Download failed: ${errorToMessage(error)}`, "danger");
      setDownloadProgress((prev) => {
        const next = { ...prev };
        delete next[modelId];
        return next;
      });
    }
  };

  const removeModel = async (modelId: string, name: string) => {
    if (!voicebar) {
      updateStatus(setStatus, PRELOAD_ERROR_MESSAGE, "danger");
      return;
    }

    try {
      await voicebar.removeModel(modelId);
      const listedModels = await voicebar.listModels();
      setModels(listedModels);
      updateStatus(setStatus, `${name} removed`, "neutral");

      if (draft.activeModelId === modelId) {
        const fallback = listedModels.find((model) => model.installed)?.id ?? listedModels[0]?.id ?? DEFAULT_SETTINGS.activeModelId;
        setDraft((prev) => ({ ...prev, activeModelId: fallback }));
        setIsDirty(true);
      }
    } catch (error) {
      updateStatus(setStatus, `Remove failed: ${errorToMessage(error)}`, "danger");
    }
  };

  const refreshChecks = async () => {
    if (!voicebar) {
      updateStatus(setStatus, PRELOAD_ERROR_MESSAGE, "danger");
      return;
    }

    updateStatus(setStatus, "Refreshing runtime and permission checks...", "neutral");
    try {
      const [critical, background] = await Promise.all([loadCriticalSettingsData(voicebar), loadNonCriticalSettingsData(voicebar)]);

      setModels(critical.listedModels);
      if (background.permission) {
        setAccessibilityGranted(background.permission.accessibility);
      }
      if (background.runtime) {
        setSpeechRuntime(background.runtime);
      }

      const warnings = [...critical.warnings, ...background.errors];
      updateStatus(setStatus, warnings.length > 0 ? `Loaded with warnings: ${warnings.join("; ")}` : "Checks refreshed", warnings.length > 0 ? "warning" : "success");
    } catch (error) {
      updateStatus(setStatus, `Refresh failed: ${errorToMessage(error)}`, "danger");
    }
  };

  const installSpeechRuntime = async () => {
    if (!voicebar) {
      updateStatus(setStatus, PRELOAD_ERROR_MESSAGE, "danger");
      return;
    }

    setIsInstallingRuntime(true);
    updateStatus(setStatus, "Installing Whisper runtime...", "neutral");

    try {
      const runtime = await voicebar.installSpeechRuntime();
      setSpeechRuntime(runtime);
      if (runtime.whisperCliFound) {
        updateStatus(setStatus, `Whisper runtime ready: ${runtime.whisperCliPath ?? "detected path"}`, "success");
      } else {
        updateStatus(setStatus, "Whisper runtime is still unavailable.", "warning");
      }
    } catch (error) {
      updateStatus(setStatus, `Runtime install failed: ${errorToMessage(error)}`, "danger");
    } finally {
      setIsInstallingRuntime(false);
    }
  };

  const openPrivacySettings = async () => {
    if (!voicebar) {
      updateStatus(setStatus, PRELOAD_ERROR_MESSAGE, "danger");
      return;
    }

    await voicebar.openPrivacySettings();
    updateStatus(setStatus, "Opened Privacy Settings", "neutral");
  };

  const startOnboardingAgain = async () => {
    if (!voicebar) {
      updateStatus(setStatus, PRELOAD_ERROR_MESSAGE, "danger");
      return;
    }

    const reset = await voicebar.resetOnboarding();
    setOnboarding(reset);
    setOnboardingStep(0);
    setWindowMode("onboarding");
    updateStatus(setStatus, "Onboarding restarted", "neutral");
  };

  const finishOnboarding = async () => {
    if (!voicebar) {
      updateStatus(setStatus, PRELOAD_ERROR_MESSAGE, "danger");
      return;
    }

    setIsCompletingOnboarding(true);
    try {
      const saved = await saveDraft();
      if (!saved) {
        return;
      }

      const completed = await voicebar.completeOnboarding({ selectedModelId: draft.activeModelId });
      setOnboarding(completed);
      setWindowMode("settings");
      setActiveSection("overview");
      updateStatus(setStatus, "Onboarding complete. You are ready to dictate.", "success");
    } finally {
      setIsCompletingOnboarding(false);
    }
  };

  const resetSpeechStats = () => {
    const empty = parseSpeechStats(null);
    setSpeechStats(empty);
    persistSpeechStats(empty);
    updateStatus(setStatus, "Speech stats reset", "neutral");
  };

  const updateThemePreference = (next: ThemePreference) => {
    setThemePreference(next);
    persistThemePreference(next);
  };

  const pageHeader = inOnboarding
    ? {
        eyebrow: `Setup step ${onboardingStep + 1} of ${ONBOARDING_STEPS.length}`,
        title: ONBOARDING_STEPS[onboardingStep],
        description: onboardingDescriptions[onboardingStep],
        badge: `${readinessRatio}% ready`
      }
    : {
        eyebrow: "Vorn Voice workspace",
        title: currentSection.label,
        description: currentSection.description,
        badge: isDirty ? "Unsaved changes" : status.tone === "success" ? "In sync" : "Stable"
      };

  return (
    <div className="workspace">
      <aside className="sidebar">
        <div className="brand-block">
          <p className="brand-eyebrow">Vorn Voice</p>
          <h1>Control Center</h1>
          <p className="brand-copy">A native-feeling dictation workspace for model setup, runtime trust, and fast daily adjustments.</p>
        </div>

        <div className="sidebar-summary">
          <div className="summary-meter">
            <div>
              <span className="summary-label">Readiness</span>
              <strong>{readinessRatio}%</strong>
            </div>
            <div className="summary-progress" aria-hidden="true">
              <span style={{ width: `${readinessRatio}%` }} />
            </div>
          </div>

          <div className="sidebar-status-list">
            <StatusKey label="Model" tone={installedModelCount > 0 ? "ready" : "attention"} value={installedModelCount > 0 ? `${installedModelCount} installed` : "Install one"} />
            <StatusKey label="Runtime" tone={runtimeReady ? "ready" : "attention"} value={runtimeReady ? "Ready" : "Needs install"} />
            <StatusKey label="Access" tone={accessibilityGranted === null ? "pending" : permissionsReady ? "ready" : "attention"} value={accessibilityGranted === null ? "Checking" : permissionsReady ? "Granted" : "Review"} />
            <StatusKey label="Hotkey" tone={recordingHotkey ? "pending" : "ready"} value={recordingHotkey ? "Recording" : formatShortcut(draft.shortcut)} />
          </div>

          <div className="theme-toggle" role="group" aria-label="Theme mode">
            <button
              className={themePreference === "light" ? "theme-chip active" : "theme-chip"}
              onClick={() => updateThemePreference("light")}
              type="button"
            >
              Light
            </button>
            <button
              className={themePreference === "dark" ? "theme-chip active" : "theme-chip"}
              onClick={() => updateThemePreference("dark")}
              type="button"
            >
              Dark
            </button>
            <button
              className={themePreference === "system" ? "theme-chip active" : "theme-chip"}
              onClick={() => updateThemePreference("system")}
              type="button"
            >
              System
            </button>
          </div>
        </div>

        {inOnboarding ? (
          <nav className="stepper" aria-label="Onboarding steps">
            {ONBOARDING_STEPS.map((step, index) => (
              <button
                key={step}
                className={index === onboardingStep ? "step active" : index < onboardingStep ? "step done" : "step"}
                onClick={() => setOnboardingStep(index)}
                type="button"
              >
                <span>{index + 1}</span>
                <div>
                  <strong>{step}</strong>
                  <small>{onboardingDescriptions[index]}</small>
                </div>
              </button>
            ))}
          </nav>
        ) : (
          <nav className="section-nav" aria-label="Settings sections">
            {SETTINGS_SECTIONS.map((section) => (
              <button
                key={section.id}
                className={activeSection === section.id ? "section-link active" : "section-link"}
                onClick={() => setActiveSection(section.id)}
                type="button"
              >
                <span>{section.label}</span>
                <small>{section.description}</small>
              </button>
            ))}
          </nav>
        )}
      </aside>

      <main className="content">
        <div className="content-scroll">
          <section className="page-hero panel-shell">
            <div>
              <p className="panel-eyebrow">{pageHeader.eyebrow}</p>
              <h2>{pageHeader.title}</h2>
              <p>{pageHeader.description}</p>
            </div>
            <div className="hero-meta">
              <span className={statusChipClass(status.tone)}>{pageHeader.badge}</span>
              <small>{focusStatus}</small>
            </div>
          </section>

          {inOnboarding ? (
            renderOnboardingStep({
              onboardingStep,
              draft,
              models,
              installedModels,
              activeModelInstalled,
              downloadProgress,
              speechRuntime,
              accessibilityGranted,
              recordingHotkey,
              isInstallingRuntime,
              status,
              toggleCapture,
              installSpeechRuntime,
              openPrivacySettings,
              setDraft,
              setIsDirty,
              downloadModel,
              removeModel
            })
          ) : (
            renderSettingsSection({
              section: activeSection,
              draft,
              models,
              installedModels,
              activeModelInstalled,
              downloadProgress,
              speechRuntime,
              accessibilityGranted,
              recordingHotkey,
              onboarding,
              averageSpeechWpm,
              weeklyWords,
              speechStats,
              readinessRatio,
              isInstallingRuntime,
              status,
              toggleCapture,
              installSpeechRuntime,
              openPrivacySettings,
              startOnboardingAgain,
              resetSpeechStats,
              setDraft,
              setIsDirty,
              downloadModel,
              removeModel
            })
          )}
        </div>

        <footer className="footer">
          <div className={`status-banner tone-${status.tone}`}>
            <strong>{footerHeading(status.tone)}</strong>
            <p>{status.text}</p>
          </div>
          {inOnboarding ? (
            <div className="footer-actions">
              <button disabled={onboardingStep === 0} onClick={() => setOnboardingStep((step) => Math.max(0, step - 1))} type="button">
                Back
              </button>
              {onboardingStep < onboardingLastStep ? (
                <button className="primary" onClick={() => setOnboardingStep((step) => Math.min(onboardingLastStep, step + 1))} type="button">
                  Continue
                </button>
              ) : (
                <button className="primary" disabled={isCompletingOnboarding || isSaving} onClick={() => void finishOnboarding()} type="button">
                  {isCompletingOnboarding ? "Finalizing..." : "Finish Setup"}
                </button>
              )}
            </div>
          ) : (
            <div className="footer-actions">
              <button onClick={() => void refreshChecks()} type="button">
                Refresh Checks
              </button>
              <button className="primary" disabled={!isDirty || isSaving} onClick={() => void saveDraft()} type="button">
                {isSaving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          )}
        </footer>
      </main>
    </div>
  );
}

type OnboardingRenderArgs = {
  onboardingStep: number;
  draft: AppSettings;
  models: ModelRow[];
  installedModels: ModelRow[];
  activeModelInstalled: boolean;
  downloadProgress: Record<string, number>;
  speechRuntime: SpeechRuntimeDiagnostics | null;
  accessibilityGranted: boolean | null;
  recordingHotkey: boolean;
  isInstallingRuntime: boolean;
  status: StatusMessage;
  toggleCapture: () => Promise<void>;
  installSpeechRuntime: () => Promise<void>;
  openPrivacySettings: () => Promise<void>;
  setDraft: React.Dispatch<React.SetStateAction<AppSettings>>;
  setIsDirty: React.Dispatch<React.SetStateAction<boolean>>;
  downloadModel: (modelId: string, name: string) => Promise<void>;
  removeModel: (modelId: string, name: string) => Promise<void>;
};

function renderOnboardingStep(args: OnboardingRenderArgs): React.ReactElement {
  const {
    onboardingStep,
    draft,
    models,
    installedModels,
    activeModelInstalled,
    downloadProgress,
    speechRuntime,
    accessibilityGranted,
    recordingHotkey,
    isInstallingRuntime,
    status,
    toggleCapture,
    installSpeechRuntime,
    openPrivacySettings,
    setDraft,
    setIsDirty,
    downloadModel,
    removeModel
  } = args;

  if (onboardingStep === 0) {
    return (
      <section className="content-stack">
        <PanelShell
          eyebrow="Get comfortable quickly"
          title="A local dictation flow that stays out of your way"
          description="Vorn Voice is built around one fast habit: hold to speak, release to transcribe, keep your cursor where you are."
          aside={<StatusPill tone="ready">Designed for focused work</StatusPill>}
        >
          <div className="feature-grid">
            <FeatureCard title="Press and hold" copy="Use one push-to-talk shortcut instead of switching apps or starting a recording session." />
            <FeatureCard title="Release to process" copy="Whisper starts transcribing immediately with the model you selected for your machine." />
            <FeatureCard title="Paste with confidence" copy="Vorn Voice can paste output directly and restore your clipboard if you want a seamless workflow." />
          </div>
        </PanelShell>

        <div className="two-column-grid">
          <PanelShell eyebrow="Before you start" title="Three things to confirm" description="Once these are ready, daily use becomes mostly invisible.">
            <div className="checklist">
              <ChecklistRow ready={installedModels.length > 0} label="Download at least one model" detail="Base is the best default for most setups." />
              <ChecklistRow ready={Boolean(speechRuntime?.whisperCliFound)} label="Install the Whisper runtime" detail="Needed for local transcription." />
              <ChecklistRow ready={accessibilityGranted === true} label="Grant Accessibility access" detail="Required to paste into your active app." />
            </div>
          </PanelShell>

          <PanelShell eyebrow="Live status" title="Current workspace signal" description="You can keep moving through setup now and return later if something still needs attention.">
            <InlineNotice tone={status.tone} text={status.text} />
          </PanelShell>
        </div>
      </section>
    );
  }

  if (onboardingStep === 1) {
    return (
      <section className="content-stack">
        <PanelShell
          eyebrow="Model selection"
          title="Choose the voice engine that matches your machine"
          description="Base balances speed and accuracy well. Tiny is quickest, and Small trades speed for cleaner transcripts."
          aside={<StatusPill tone={installedModels.length > 0 ? "ready" : "attention"}>{installedModels.length > 0 ? `${installedModels.length} installed` : "No models installed"}</StatusPill>}
        >
          <ModelManagerPanel
            draft={draft}
            models={models}
            downloadProgress={downloadProgress}
            installedModels={installedModels}
            activeModelInstalled={activeModelInstalled}
            setDraft={setDraft}
            setIsDirty={setIsDirty}
            downloadModel={downloadModel}
            removeModel={removeModel}
          />
        </PanelShell>
      </section>
    );
  }

  if (onboardingStep === 2) {
    return (
      <section className="content-stack">
        <div className="status-grid">
          <HealthCard
            title="Whisper runtime"
            description={speechRuntime?.whisperCliFound ? speechRuntime.whisperCliPath ?? "Runtime detected" : "Install the local runtime to start transcription."}
            tone={speechRuntime?.whisperCliFound ? "ready" : "attention"}
            action={
              !speechRuntime?.whisperCliFound ? (
                <button onClick={() => void installSpeechRuntime()} type="button">
                  {isInstallingRuntime ? "Installing..." : "Install Runtime"}
                </button>
              ) : undefined
            }
          />
          <HealthCard
            title="Accessibility"
            description={
              accessibilityGranted === null
                ? "Checking macOS permissions."
                : accessibilityGranted
                  ? "Accessibility access is granted."
                  : "Grant access so Vorn Voice can paste into your active app."
            }
            tone={accessibilityGranted === null ? "pending" : accessibilityGranted ? "ready" : "attention"}
            action={
              accessibilityGranted ? undefined : (
                <button onClick={() => void openPrivacySettings()} type="button">
                  Open Privacy Settings
                </button>
              )
            }
          />
        </div>

        <PanelShell eyebrow="Why this matters" title="Dictation should feel dependable" description="This step removes the two most common reasons a first transcription fails.">
          <div className="checklist">
            <ChecklistRow ready={Boolean(speechRuntime?.whisperCliFound)} label="Runtime installed" detail="The local CLI must be available on this Mac." />
            <ChecklistRow ready={accessibilityGranted === true} label="macOS access granted" detail="Needed only for pasting into other apps." />
          </div>
        </PanelShell>
      </section>
    );
  }

  if (onboardingStep === 3) {
    return (
      <section className="content-stack">
        <PanelShell
          eyebrow="Push-to-talk"
          title="Set a shortcut you can use all day"
          description="Choose something easy to hold, unlikely to collide, and comfortable to repeat hundreds of times."
          aside={<StatusPill tone={recordingHotkey ? "pending" : "ready"}>{recordingHotkey ? "Listening for keys" : formatShortcut(draft.shortcut)}</StatusPill>}
        >
          <HotkeyPanel draft={draft} recordingHotkey={recordingHotkey} toggleCapture={toggleCapture} />
        </PanelShell>

        <PanelShell eyebrow="Hotkey advice" title="What usually works best" description="Reliable shortcuts are ergonomic and hard to trigger accidentally.">
          <div className="tip-list">
            <TipCard title="Prefer modifiers" copy="Combinations with Shift, Command, or Option are easier to reserve for dictation." />
            <TipCard title="Avoid crowded shortcuts" copy="Stay away from common app commands you already use every few minutes." />
            <TipCard title="Keep it comfortable" copy="You will hold this key combo while speaking, so comfort matters more than novelty." />
          </div>
        </PanelShell>
      </section>
    );
  }

  return (
    <section className="content-stack">
      <PanelShell
        eyebrow="Final review"
        title="You are almost ready to dictate"
        description="Check the essentials once, then finish setup. You can fine-tune everything later in the full workspace."
        aside={<StatusPill tone={installedModels.length > 0 && Boolean(speechRuntime?.whisperCliFound) && accessibilityGranted ? "ready" : "attention"}>{installedModels.length > 0 ? `${installedModels.length} model${installedModels.length === 1 ? "" : "s"}` : "No installed model"}</StatusPill>}
      >
        <div className="summary-grid">
          <SummaryCard title="Default model" value={draft.activeModelId} detail={activeModelInstalled ? "Installed and ready" : "Choose an installed model before saving"} tone={activeModelInstalled ? "ready" : "attention"} />
          <SummaryCard title="Runtime" value={speechRuntime?.whisperCliFound ? "Ready" : "Needs install"} detail={speechRuntime?.whisperCliPath ?? "Local engine check"} tone={speechRuntime?.whisperCliFound ? "ready" : "attention"} />
          <SummaryCard title="Accessibility" value={accessibilityGranted ? "Granted" : "Needs attention"} detail="Controls auto-paste into other apps" tone={accessibilityGranted ? "ready" : "attention"} />
          <SummaryCard title="Hotkey" value={formatShortcut(draft.shortcut)} detail="Hold to dictate, release to transcribe" tone="ready" />
        </div>
      </PanelShell>
    </section>
  );
}

type SettingsRenderArgs = {
  section: SectionId;
  draft: AppSettings;
  models: ModelRow[];
  installedModels: ModelRow[];
  activeModelInstalled: boolean;
  downloadProgress: Record<string, number>;
  speechRuntime: SpeechRuntimeDiagnostics | null;
  accessibilityGranted: boolean | null;
  recordingHotkey: boolean;
  onboarding: OnboardingState;
  averageSpeechWpm: number;
  weeklyWords: number;
  speechStats: SpeechStats;
  readinessRatio: number;
  isInstallingRuntime: boolean;
  status: StatusMessage;
  toggleCapture: () => Promise<void>;
  installSpeechRuntime: () => Promise<void>;
  openPrivacySettings: () => Promise<void>;
  startOnboardingAgain: () => Promise<void>;
  resetSpeechStats: () => void;
  setDraft: React.Dispatch<React.SetStateAction<AppSettings>>;
  setIsDirty: React.Dispatch<React.SetStateAction<boolean>>;
  downloadModel: (modelId: string, name: string) => Promise<void>;
  removeModel: (modelId: string, name: string) => Promise<void>;
};

function renderSettingsSection(args: SettingsRenderArgs): React.ReactElement {
  const {
    section,
    draft,
    models,
    installedModels,
    activeModelInstalled,
    downloadProgress,
    speechRuntime,
    accessibilityGranted,
    recordingHotkey,
    onboarding,
    averageSpeechWpm,
    weeklyWords,
    speechStats,
    readinessRatio,
    isInstallingRuntime,
    status,
    toggleCapture,
    installSpeechRuntime,
    openPrivacySettings,
    startOnboardingAgain,
    resetSpeechStats,
    setDraft,
    setIsDirty,
    downloadModel,
    removeModel
  } = args;

  if (section === "overview") {
    return (
      <section className="content-stack">
        <PanelShell
          eyebrow="Workspace health"
          title="Daily dictation at a glance"
          description="This view keeps the system-critical pieces visible so you can trust the next transcription before you start speaking."
          aside={<StatusPill tone={readinessRatio >= 80 ? "ready" : "attention"}>{readinessRatio}% ready</StatusPill>}
        >
          <div className="dashboard-grid">
            <SummaryCard title="Setup" value={onboarding.completed ? "Complete" : "Incomplete"} detail={onboarding.completed ? "You can rerun setup anytime" : "Finish setup for a guided flow"} tone={onboarding.completed ? "ready" : "attention"} action={<button onClick={() => void startOnboardingAgain()} type="button">Run Setup Wizard</button>} />
            <SummaryCard title="Model library" value={`${installedModels.length}/${models.length || 0}`} detail={installedModels.length > 0 ? `Default: ${draft.activeModelId}` : "Download a model to begin"} tone={installedModels.length > 0 ? "ready" : "attention"} />
            <SummaryCard title="Runtime" value={speechRuntime?.whisperCliFound ? "Installed" : "Missing"} detail={speechRuntime?.whisperCliPath ?? "Local engine diagnostics"} tone={speechRuntime?.whisperCliFound ? "ready" : "attention"} action={!speechRuntime?.whisperCliFound ? <button onClick={() => void installSpeechRuntime()} type="button">Install Runtime</button> : undefined} />
            <SummaryCard title="Permissions" value={accessibilityGranted ? "Granted" : accessibilityGranted === null ? "Checking" : "Needs review"} detail="Needed for auto-paste into your active app" tone={accessibilityGranted === null ? "pending" : accessibilityGranted ? "ready" : "attention"} action={!accessibilityGranted ? <button onClick={() => void openPrivacySettings()} type="button">Open Privacy Settings</button> : undefined} />
          </div>
        </PanelShell>

        <div className="two-column-grid">
          <PanelShell eyebrow="Workflow defaults" title="Current dictation behavior" description="These settings shape how Vorn Voice behaves every time you dictate.">
            <div className="stacked-facts">
              <FactRow label="Default model" value={draft.activeModelId} />
              <FactRow label="Auto-paste" value={draft.autoPaste ? "Enabled" : "Manual"} />
              <FactRow label="Clipboard restore" value={draft.autoPaste && draft.restoreClipboard ? "Enabled" : "Off"} />
              <FactRow label="Auto-updates" value={draft.autoUpdateEnabled ? "Enabled" : "Manual"} />
            </div>
          </PanelShell>

          <PanelShell eyebrow="Recent signal" title="What needs your attention now" description="The footer stays available, but important context is surfaced here too.">
            <InlineNotice tone={status.tone} text={status.text} />
          </PanelShell>
        </div>
      </section>
    );
  }

  if (section === "hotkey") {
    return (
      <section className="content-stack">
        <PanelShell
          eyebrow="Push-to-talk"
          title="A shortcut built for repetition"
          description="This is the only input you use constantly, so it should be comfortable and easy to remember."
          aside={<StatusPill tone={recordingHotkey ? "pending" : "ready"}>{recordingHotkey ? "Capturing" : "Ready"}</StatusPill>}
        >
          <HotkeyPanel draft={draft} recordingHotkey={recordingHotkey} toggleCapture={toggleCapture} />
        </PanelShell>
      </section>
    );
  }

  if (section === "models") {
    return (
      <section className="content-stack">
        <PanelShell
          eyebrow="Local models"
          title="Keep quality and speed in balance"
          description="All recognition runs locally, so installed models are the core of the app experience."
          aside={<StatusPill tone={activeModelInstalled ? "ready" : "attention"}>{activeModelInstalled ? "Default is ready" : "Select an installed model"}</StatusPill>}
        >
          <ModelManagerPanel
            draft={draft}
            models={models}
            installedModels={installedModels}
            activeModelInstalled={activeModelInstalled}
            downloadProgress={downloadProgress}
            setDraft={setDraft}
            setIsDirty={setIsDirty}
            downloadModel={downloadModel}
            removeModel={removeModel}
          />
        </PanelShell>
      </section>
    );
  }

  if (section === "runtime") {
    return (
      <section className="content-stack">
        <PanelShell
          eyebrow="Engine diagnostics"
          title="Confirm local transcription is available"
          description="If the runtime is healthy, the rest of the product usually feels instant and predictable."
          aside={<StatusPill tone={speechRuntime?.whisperCliFound ? "ready" : "attention"}>{speechRuntime?.whisperCliFound ? "Ready" : "Needs install"}</StatusPill>}
        >
          <HealthCard
            title="Whisper CLI"
            description={speechRuntime?.whisperCliFound ? speechRuntime.whisperCliPath ?? "Runtime detected" : "No runtime found in checked locations yet."}
            tone={speechRuntime?.whisperCliFound ? "ready" : "attention"}
            action={
              !speechRuntime?.whisperCliFound ? (
                <button onClick={() => void installSpeechRuntime()} type="button">
                  {isInstallingRuntime ? "Installing..." : "Install Runtime"}
                </button>
              ) : undefined
            }
          />
          {speechRuntime && speechRuntime.checkedPaths.length > 0 ? (
            <div className="token-list" aria-label="Checked paths">
              {speechRuntime.checkedPaths.map((path) => (
                <code key={path}>{path}</code>
              ))}
            </div>
          ) : null}
        </PanelShell>
      </section>
    );
  }

  if (section === "permissions") {
    return (
      <section className="content-stack">
        <PanelShell
          eyebrow="macOS privacy"
          title="Accessibility keeps auto-paste seamless"
          description="Without this permission, Vorn Voice can still transcribe but cannot finish the handoff into other apps automatically."
          aside={<StatusPill tone={accessibilityGranted === null ? "pending" : accessibilityGranted ? "ready" : "attention"}>{accessibilityGranted === null ? "Checking" : accessibilityGranted ? "Granted" : "Needs review"}</StatusPill>}
        >
          <HealthCard
            title="Accessibility access"
            description={
              accessibilityGranted === null
                ? "Checking current permission state."
                : accessibilityGranted
                  ? "macOS has granted the app permission to control UI input for pasting."
                  : "Grant access, then return here and refresh checks if needed."
            }
            tone={accessibilityGranted === null ? "pending" : accessibilityGranted ? "ready" : "attention"}
            action={
              accessibilityGranted ? undefined : (
                <button onClick={() => void openPrivacySettings()} type="button">
                  Open Privacy Settings
                </button>
              )
            }
          />
        </PanelShell>
      </section>
    );
  }

  if (section === "paste") {
    return (
      <section className="content-stack">
        <PanelShell eyebrow="Output handoff" title="Choose how text lands in the active app" description="These defaults control whether Vorn Voice pastes for you or only leaves a transcript ready to use.">
          <div className="setting-grid">
            <ToggleCard
              title="Auto-paste after transcription"
              description="Send the transcribed text straight into the app you are already using."
              checked={draft.autoPaste}
              onChange={(checked) => {
                setDraft((prev) => ({ ...prev, autoPaste: checked }));
                setIsDirty(true);
              }}
            />
            <ToggleCard
              title="Restore clipboard after paste"
              description="Put your previous clipboard content back after Vorn Voice finishes inserting text."
              checked={draft.restoreClipboard}
              disabled={!draft.autoPaste}
              onChange={(checked) => {
                setDraft((prev) => ({ ...prev, restoreClipboard: checked }));
                setIsDirty(true);
              }}
            />
          </div>
        </PanelShell>
      </section>
    );
  }

  if (section === "updates") {
    return (
      <section className="content-stack">
        <PanelShell eyebrow="Maintenance" title="Decide how hands-off updates should be" description="Keeping updates automatic is the easiest way to pick up runtime and workflow improvements without extra work.">
          <div className="setting-grid single-column">
            <ToggleCard
              title="Enable automatic updates"
              description="Allow Vorn Voice to download and apply updates from your configured feed automatically."
              checked={draft.autoUpdateEnabled}
              onChange={(checked) => {
                setDraft((prev) => ({ ...prev, autoUpdateEnabled: checked }));
                setIsDirty(true);
              }}
            />
          </div>
        </PanelShell>
      </section>
    );
  }

  return (
    <section className="content-stack">
      <PanelShell eyebrow="Speech metrics" title="A small diagnostic view for speaking rhythm" description="This is intentionally lightweight, but it is enough to tell whether your pace is consistent over time.">
        <div className="dashboard-grid metrics-grid-wide">
          <MetricCard label="Average speed" value={`${Math.round(averageSpeechWpm)} WPM`} />
          <MetricCard label="Words this week" value={String(weeklyWords)} />
          <MetricCard label="Samples tracked" value={String(speechStats.sampleCount)} />
          <MetricCard label="Last sample" value={speechStats.lastSampleWpm ? `${Math.round(speechStats.lastSampleWpm)} WPM` : "-"} />
        </div>
        <div className="panel-actions align-end">
          <button onClick={resetSpeechStats} type="button">
            Reset Stats
          </button>
        </div>
      </PanelShell>
    </section>
  );
}

type ModelPanelArgs = {
  draft: AppSettings;
  models: ModelRow[];
  installedModels: ModelRow[];
  activeModelInstalled: boolean;
  downloadProgress: Record<string, number>;
  setDraft: React.Dispatch<React.SetStateAction<AppSettings>>;
  setIsDirty: React.Dispatch<React.SetStateAction<boolean>>;
  downloadModel: (modelId: string, name: string) => Promise<void>;
  removeModel: (modelId: string, name: string) => Promise<void>;
};

function ModelManagerPanel(props: ModelPanelArgs): React.ReactElement {
  const {
    draft,
    models,
    installedModels,
    activeModelInstalled,
    downloadProgress,
    setDraft,
    setIsDirty,
    downloadModel,
    removeModel
  } = props;

  return (
    <div className="content-stack compact">
      <div className="field-card">
        <div>
          <p className="field-label">Default model</p>
          <p className="field-copy">The selected model is used for new dictation sessions.</p>
        </div>
        <select
          id="model-select"
          disabled={models.length === 0}
          value={draft.activeModelId}
          onChange={(event) => {
            setDraft((prev) => ({ ...prev, activeModelId: event.target.value }));
            setIsDirty(true);
          }}
        >
          {models.length === 0 ? (
            <option value={draft.activeModelId}>No models available</option>
          ) : (
            models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))
          )}
        </select>
      </div>

      {models.length > 0 && !activeModelInstalled ? <InlineNotice tone="warning" text="Your current default model is not installed yet. Download it or select an installed option before saving." /> : null}

      <div className="model-grid refined">
        {models.map((model) => {
          const progress = downloadProgress[model.id];
          const isDownloading = progress !== undefined && progress < 100;
          const isActive = draft.activeModelId === model.id;

          return (
            <article key={model.id} className={model.installed ? "model-card installed" : "model-card"}>
              <div className="model-card-header">
                <div>
                  <h3>{model.name}</h3>
                  <p>{model.details}</p>
                </div>
                {isActive ? <StatusPill tone={model.installed ? "ready" : "attention"}>Default</StatusPill> : null}
              </div>

              <div className="model-card-footer">
                {isDownloading ? (
                  <div className="progress-panel">
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${progress}%` }} />
                    </div>
                    <span>{progress}%</span>
                  </div>
                ) : model.installed ? (
                  <div className="panel-actions">
                    <span className="meta-text">Installed locally</span>
                    <button onClick={() => void removeModel(model.id, model.name)} type="button">
                      Remove
                    </button>
                  </div>
                ) : (
                  <div className="panel-actions">
                    <span className="meta-text">Available to download</span>
                    <button onClick={() => void downloadModel(model.id, model.name)} type="button">
                      Download
                    </button>
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <div className="token-list" aria-label="Installed models">
        {(installedModels.length > 0 ? installedModels : [{ id: "none", name: "No installed models", details: "", installed: false }]).map((model) => (
          <code key={model.id}>{model.name}</code>
        ))}
      </div>
    </div>
  );
}

function PanelShell(props: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="panel-shell">
      <div className="panel-head">
        <div>
          <p className="panel-eyebrow">{props.eyebrow}</p>
          <h3>{props.title}</h3>
          <p>{props.description}</p>
        </div>
        {props.aside ? <div className="panel-head-aside">{props.aside}</div> : null}
      </div>
      {props.children}
    </section>
  );
}

function StatusKey({ label, value, tone }: { label: string; value: string; tone: HealthTone }): React.ReactElement {
  return (
    <div className="status-key">
      <span className={`status-dot tone-${tone}`} aria-hidden="true" />
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function StatusPill({ tone, children }: { tone: HealthTone; children: React.ReactNode }): React.ReactElement {
  return <span className={`status-pill tone-${tone}`}>{children}</span>;
}

function InlineNotice({ tone, text }: { tone: StatusTone | "warning"; text: string }): React.ReactElement {
  const mappedTone = tone === "warning" ? "warning" : tone;
  return <div className={`inline-notice tone-${mappedTone}`}>{text}</div>;
}

function FeatureCard({ title, copy }: { title: string; copy: string }): React.ReactElement {
  return (
    <article className="feature-card">
      <h4>{title}</h4>
      <p>{copy}</p>
    </article>
  );
}

function TipCard({ title, copy }: { title: string; copy: string }): React.ReactElement {
  return (
    <article className="tip-card">
      <h4>{title}</h4>
      <p>{copy}</p>
    </article>
  );
}

function ChecklistRow({ ready, label, detail }: { ready: boolean; label: string; detail: string }): React.ReactElement {
  return (
    <div className="checklist-row">
      <span className={ready ? "checklist-mark ready" : "checklist-mark"} aria-hidden="true" />
      <div>
        <strong>{label}</strong>
        <p>{detail}</p>
      </div>
    </div>
  );
}

function HealthCard(props: { title: string; description: string; tone: HealthTone; action?: React.ReactNode }): React.ReactElement {
  return (
    <article className={`health-card tone-${props.tone}`}>
      <div className="health-card-head">
        <StatusPill tone={props.tone}>{healthLabel(props.tone)}</StatusPill>
        <h4>{props.title}</h4>
      </div>
      <p>{props.description}</p>
      {props.action ? <div className="panel-actions">{props.action}</div> : null}
    </article>
  );
}

function HotkeyPanel(props: {
  draft: AppSettings;
  recordingHotkey: boolean;
  toggleCapture: () => Promise<void>;
}): React.ReactElement {
  return (
    <div className="hotkey-card polished">
      <div>
        <p className="field-label">Current shortcut</p>
        <div className="hotkey-value">{props.recordingHotkey ? "Waiting for key press..." : formatShortcut(props.draft.shortcut)}</div>
      </div>
      <button className={props.recordingHotkey ? "recording" : "primary"} onClick={() => void props.toggleCapture()} type="button">
        {props.recordingHotkey ? "Cancel Capture" : "Record New Hotkey"}
      </button>
    </div>
  );
}

function ToggleCard(props: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}): React.ReactElement {
  return (
    <label className={props.disabled ? "toggle-card disabled" : "toggle-card"}>
      <div>
        <h4>{props.title}</h4>
        <p>{props.description}</p>
      </div>
      <input checked={props.checked} disabled={props.disabled} onChange={(event) => props.onChange(event.target.checked)} type="checkbox" />
    </label>
  );
}

function SummaryCard(props: {
  title: string;
  value: string;
  detail: string;
  tone: HealthTone;
  action?: React.ReactNode;
}): React.ReactElement {
  return (
    <article className={`summary-card tone-${props.tone}`}>
      <div className="summary-card-head">
        <small>{props.title}</small>
        <StatusPill tone={props.tone}>{healthLabel(props.tone)}</StatusPill>
      </div>
      <strong>{props.value}</strong>
      <p>{props.detail}</p>
      {props.action ? <div className="panel-actions">{props.action}</div> : null}
    </article>
  );
}

function MetricCard({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <article className="metric-card">
      <small>{label}</small>
      <strong>{value}</strong>
    </article>
  );
}

function FactRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="fact-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function getVoicebarApi(): Window["voicebar"] | undefined {
  const candidate = (window as Window & { voicebar?: Window["voicebar"] }).voicebar;
  return candidate;
}

function parseWindowMode(): SettingsWindowMode {
  const mode = new URLSearchParams(window.location.search).get("mode");
  return mode === "onboarding" ? "onboarding" : "settings";
}

async function loadCriticalSettingsData(
  voicebar: VoicebarApi
): Promise<{ snapshot: AppSnapshot; listedModels: ModelRow[]; warnings: string[] }> {
  const [stateResult, modelsResult] = await Promise.allSettled([
    withTimeout(voicebar.getState(), CRITICAL_IPC_TIMEOUT_MS, "State load"),
    withTimeout(voicebar.listModels(), CRITICAL_IPC_TIMEOUT_MS, "Model list load")
  ]);

  const warnings: string[] = [];
  let snapshot = FALLBACK_SNAPSHOT;
  let listedModels: ModelRow[] = [];

  if (stateResult.status === "fulfilled") {
    snapshot = stateResult.value;
  } else {
    warnings.push(`State load failed: ${errorToMessage(stateResult.reason)}`);
  }

  if (modelsResult.status === "fulfilled") {
    listedModels = modelsResult.value;
  } else {
    warnings.push(`Model list failed: ${errorToMessage(modelsResult.reason)}`);
  }

  return { snapshot, listedModels, warnings };
}

async function loadNonCriticalSettingsData(
  voicebar: VoicebarApi
): Promise<{ permission?: { accessibility: boolean }; runtime?: SpeechRuntimeDiagnostics; errors: string[] }> {
  const [permissionResult, runtimeResult] = await Promise.allSettled([
    withTimeout(voicebar.checkPermissions(), NON_CRITICAL_IPC_TIMEOUT_MS, "Permissions check"),
    withTimeout(voicebar.getSpeechRuntimeDiagnostics(), NON_CRITICAL_IPC_TIMEOUT_MS, "Runtime diagnostics")
  ]);

  const errors: string[] = [];
  let permission: { accessibility: boolean } | undefined;
  let runtime: SpeechRuntimeDiagnostics | undefined;

  if (permissionResult.status === "fulfilled") {
    permission = permissionResult.value;
  } else {
    errors.push(`Permissions check failed: ${errorToMessage(permissionResult.reason)}`);
  }

  if (runtimeResult.status === "fulfilled") {
    runtime = runtimeResult.value;
  } else {
    errors.push(`Runtime diagnostics failed: ${errorToMessage(runtimeResult.reason)}`);
  }

  return { permission, runtime, errors };
}

function loadSpeechStats(): SpeechStats {
  try {
    return parseSpeechStats(window.localStorage.getItem(SPEECH_STATS_STORAGE_KEY));
  } catch {
    return parseSpeechStats(null);
  }
}

function loadThemePreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (value === "light" || value === "dark" || value === "system") {
      return value;
    }
  } catch {
    // Ignore localStorage read failures.
  }

  return "system";
}

function persistThemePreference(theme: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore localStorage write failures.
  }
}

function persistSpeechStats(stats: SpeechStats): void {
  try {
    window.localStorage.setItem(SPEECH_STATS_STORAGE_KEY, JSON.stringify(stats));
  } catch {
    // Ignore localStorage write failures.
  }
}

function applySampleToStats(sample: SpeechSample | undefined, setSpeechStats: React.Dispatch<React.SetStateAction<SpeechStats>>): void {
  if (!sample) {
    return;
  }

  setSpeechStats((previous) => {
    const next = applySpeechSample(previous, sample);
    if (next === previous) {
      return previous;
    }

    persistSpeechStats(next);
    return next;
  });
}

function buildFocusStatus(props: {
  inOnboarding: boolean;
  status: StatusMessage;
  isDirty: boolean;
  runtimeReady: boolean;
  permissionsReady: boolean;
  installedModelCount: number;
  activeModelInstalled: boolean;
  recordingHotkey: boolean;
}): string {
  if (props.inOnboarding) {
    if (!props.runtimeReady) return "Install the runtime to unlock local transcription.";
    if (!props.permissionsReady) return "Grant Accessibility access for seamless auto-paste.";
    if (props.installedModelCount === 0) return "Download a model to finish setup strongly.";
    return "The last setup choices should only take a moment.";
  }

  if (props.isDirty) return "You have unsaved changes waiting in this workspace.";
  if (!props.activeModelInstalled) return "Your default model is not installed yet.";
  if (props.recordingHotkey) return "Listening for your next shortcut.";
  return props.status.text;
}

function updateStatus(setStatus: React.Dispatch<React.SetStateAction<StatusMessage>>, text: string, tone: StatusTone): void {
  setStatus({ text, tone });
}

function footerHeading(tone: StatusTone): string {
  if (tone === "success") return "All set";
  if (tone === "warning") return "Needs attention";
  if (tone === "danger") return "Action needed";
  return "Workspace status";
}

function statusChipClass(tone: StatusTone): string {
  return `hero-chip tone-${tone}`;
}

function healthLabel(tone: HealthTone): string {
  if (tone === "ready") return "Ready";
  if (tone === "pending") return "Checking";
  return "Attention";
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout>;

  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timeoutHandle);
  });
}

const onboardingDescriptions = [
  "Understand the workflow before you configure anything.",
  "Install the right model for your machine and accuracy needs.",
  "Confirm the local runtime and macOS access are both healthy.",
  "Choose the shortcut you will use every day.",
  "Review the essentials and finish setup."
];
