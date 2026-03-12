import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { averageWpm, createEmptySpeechStats, wordsThisWeek } from "../../shared/speechStats";
import {
  AppSettings,
  AppSnapshot,
  BUNDLED_MODEL_IDS,
  DEFAULT_MODEL_ID,
  KeyboardShortcut,
  ModelListItem,
  OnboardingState,
  OnboardingVerificationState,
  PermissionsSnapshot,
  SpeechCleanupMode,
  SpeechPipelineDiagnostics,
  SpeechStats,
  SettingsWindowMode,
  SpeechRuntimeDiagnostics,
  UpdateStatus
} from "../../shared/types";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardHeader } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Switch } from "../components/ui/switch";
import { cn } from "../lib/utils";

type StatusTone = "neutral" | "success" | "warning" | "danger";

type CriticalSettingsData = {
  snapshot: AppSnapshot;
  models: ModelListItem[];
  speechStats: SpeechStats;
};

type SupportChecksData = {
  permission?: PermissionsSnapshot;
  runtime?: SpeechRuntimeDiagnostics;
  errors: string[];
};

type StatusMessage = {
  tone: StatusTone;
  text: string;
};

type DraftUpdateOptions = {
  immediateSave?: boolean;
};

type SettingsTabId = "overview" | "general" | "models" | "stats" | "advanced";

type SettingsTabItem = {
  description: string;
  id: SettingsTabId;
  label: string;
};

const AUTOSAVE_DELAY_MS = 500;
const TOAST_DURATION_MS = 1800;

const SETTINGS_TABS: SettingsTabItem[] = [
  { id: "overview", label: "Overview", description: "Quick read on readiness, runtime health, and recent dictation activity." },
  { id: "general", label: "General", description: "Tune the shortcut, auto-paste behavior, and recording feel." },
  { id: "models", label: "Models", description: "Install, remove, and switch between local transcription models." },
  { id: "stats", label: "Stats", description: "Review your local word counts, pace, and latest sessions." },
  { id: "advanced", label: "Advanced", description: "Handle runtime troubleshooting, update controls, and diagnostics." }
];

const ONBOARDING_STEPS = [
  "Choose a model",
  "Enable access",
  "Pick a hotkey",
  "Finish"
] as const;

const CARD_BASE_CLASS = "relative overflow-hidden rounded-[28px] border-[rgba(249,115,22,0.14)] bg-[linear-gradient(180deg,rgba(19,19,19,0.98)_0%,rgba(16,16,16,0.98)_100%)] shadow-[0_22px_50px_rgba(0,0,0,0.38)]";
const SUB_PANEL_CLASS = "rounded-2xl border border-[rgba(249,115,22,0.1)] bg-[linear-gradient(180deg,rgba(19,19,19,0.96)_0%,rgba(17,17,17,0.98)_100%)] p-4";
const TOKEN_BADGE_CLASS = "rounded-full border-[rgba(249,115,22,0.16)] bg-[#121212] text-[rgb(var(--muted-foreground))]";
const FULLSCREEN_CONTENT_WIDTH_CLASS = "w-full max-w-[min(1540px,100vw)]";

export function SettingsApp(): ReactElement {
  const voicebar = getVoicebarApi();
  const [windowMode, setWindowMode] = useState<SettingsWindowMode>(parseWindowMode());
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTabId>("overview");
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [speechStats, setSpeechStats] = useState<SpeechStats>(createEmptySpeechStats());
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null);
  const [models, setModels] = useState<ModelListItem[]>([]);
  const [permissionState, setPermissionState] = useState<PermissionsSnapshot | null>(null);
  const [runtimeState, setRuntimeState] = useState<SpeechRuntimeDiagnostics | null>(null);
  const [downloadModelId, setDownloadModelId] = useState<string | null>(null);
  const [removingModelId, setRemovingModelId] = useState<string | null>(null);
  const [capturePending, setCapturePending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [installingRuntime, setInstallingRuntime] = useState(false);
  const [completingOnboarding, setCompletingOnboarding] = useState(false);
  const [status, setStatus] = useState<StatusMessage>({ tone: "neutral", text: "Loading settings..." });
  const [toast, setToast] = useState<StatusMessage | null>(null);
  const [appVersion, setAppVersion] = useState("Unknown");
  const [updateState, setUpdateState] = useState<UpdateStatus | null>(null);
  const [checkingForUpdates, setCheckingForUpdates] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [onboardingVerification, setOnboardingVerification] = useState<OnboardingVerificationState | null>(null);
  const draftRef = useRef<AppSettings | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const skipAutosaveRef = useRef(true);
  const nextAutosaveDelayRef = useRef(AUTOSAVE_DELAY_MS);
  const lastSavedSignatureRef = useRef<string | null>(null);
  const lastSpeechSampleIdRef = useRef<string | null>(null);
  const requestSaveRef = useRef<(nextSettings: AppSettings, options?: { statusText?: string; toastText?: string }) => Promise<boolean>>(async () => false);
  const settingsContentRef = useRef<HTMLElement | null>(null);

  const ready = Boolean(snapshot && draft && onboarding && onboardingVerification);
  const installedModels = useMemo(() => models.filter((model) => model.installed), [models]);
  const activeModel = useMemo(
    () => models.find((model) => model.id === draft?.activeModelId),
    [draft?.activeModelId, models]
  );
  const activeModelInstalled = Boolean(activeModel?.installed);
  const runtimeReady = Boolean(runtimeState?.whisperCliFound);
  const microphoneGranted = permissionState?.microphone === "granted";
  const accessibilityReady = draft?.autoPaste ? permissionState?.accessibility === true : true;
  const hotkeyReady = permissionState?.hotkeyReady !== false;
  const dictationTestReady = Boolean(activeModelInstalled && runtimeReady && microphoneGranted && hotkeyReady);
  const setupReady = Boolean(dictationTestReady && accessibilityReady);
  const onboardingVerified = Boolean(
    onboarding?.dictationVerified
    && onboarding.verifiedModelId === draft?.activeModelId
    && sameShortcut(onboarding.verifiedShortcut, draft?.shortcut)
  );
  const completeReady = Boolean(setupReady && onboardingVerified);

  const clearAutosaveTimer = () => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  };

  const showToast = (message: StatusMessage) => {
    setToast(message);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }

    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, TOAST_DURATION_MS);
  };

  useEffect(() => {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.style.colorScheme = "dark";
  }, []);

  useLayoutEffect(() => {
    if (windowMode !== "settings") {
      return;
    }

    settingsContentRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [activeSettingsTab, windowMode]);

  const selectSettingsTab = (tabId: SettingsTabId) => {
    setActiveSettingsTab((currentTab) => (currentTab === tabId ? currentTab : tabId));
  };

  useEffect(() => {
    if (!voicebar) {
      setStatus({ tone: "danger", text: "Bridge unavailable. Restart Vorn Voice and open settings again." });
      return;
    }

    let cancelled = false;

    const bootstrap = async () => {
      try {
        const [critical, onboardingState, verificationState, currentAppVersion, currentUpdateState] = await Promise.all([
          loadCriticalSettingsData(voicebar),
          withTimeout(voicebar.getOnboardingState(), 5000, "Onboarding"),
          withTimeout(voicebar.getOnboardingVerificationState(), 5000, "Onboarding verification"),
          withTimeout(voicebar.getAppVersion(), 5000, "App version"),
          withTimeout(voicebar.getUpdateState(), 5000, "Update status")
        ]);

        if (cancelled) {
          return;
        }

        setSnapshot(critical.snapshot);
        setSpeechStats(critical.speechStats);
        draftRef.current = critical.snapshot.settings;
        lastSpeechSampleIdRef.current = critical.snapshot.lastSpeechSample?.id ?? null;
        lastSavedSignatureRef.current = settingsSignature(critical.snapshot.settings);
        skipAutosaveRef.current = true;
        setDraft(critical.snapshot.settings);
        setModels(critical.models);
        setOnboarding(onboardingState);
        setOnboardingVerification(verificationState);
        setAppVersion(currentAppVersion);
        setUpdateState(currentUpdateState);
        setWindowMode(onboardingState.completed ? parseWindowMode() : "onboarding");

        const support = await loadSupportChecks(voicebar);
        if (cancelled) {
          return;
        }

        if (support.permission) {
          setPermissionState(support.permission);
        }

        if (support.runtime) {
          setRuntimeState(support.runtime);
        }

        setStatus({
          tone: support.errors.length > 0 ? "warning" : "neutral",
          text: support.errors[0] ?? (onboardingState.completed ? "Vorn Voice is ready." : "Finish setup to start dictating.")
        });
      } catch (error) {
        if (!cancelled) {
          setStatus({ tone: "danger", text: errorToMessage(error) });
        }
      }
    };

    void bootstrap();

    const unsubscribeState = voicebar.onStateChanged((nextSnapshot) => {
      if (cancelled) {
        return;
      }

      setSnapshot(nextSnapshot);
      const nextSpeechSampleId = nextSnapshot.lastSpeechSample?.id ?? null;
      if (nextSpeechSampleId && nextSpeechSampleId !== lastSpeechSampleIdRef.current) {
        lastSpeechSampleIdRef.current = nextSpeechSampleId;
        void voicebar.getSpeechStats().then(setSpeechStats).catch(() => undefined);
      }
      draftRef.current = saving ? draftRef.current : nextSnapshot.settings;
      lastSavedSignatureRef.current = settingsSignature(nextSnapshot.settings);
      skipAutosaveRef.current = true;
      setDraft((currentDraft) => (saving ? currentDraft : nextSnapshot.settings));
    });

    const unsubscribeCaptured = voicebar.onHotkeyCaptured((shortcut) => {
      if (cancelled) {
        return;
      }

      setCapturePending(false);
      updateDraft((current) => ({ ...current, shortcut }), { immediateSave: windowMode === "settings" });
      setStatus({ tone: "success", text: `Hotkey updated to ${shortcut.display ?? "your new shortcut"}.` });
    });

    const unsubscribeUpdateState = voicebar.onUpdateStateChanged((nextUpdateState) => {
      if (cancelled) {
        return;
      }

      setUpdateState(nextUpdateState);
    });

    const unsubscribeOnboardingVerification = voicebar.onOnboardingVerificationChanged((nextVerificationState) => {
      if (cancelled) {
        return;
      }

      setOnboardingVerification(nextVerificationState);
    });

    const refreshOnFocus = () => {
      void refreshSupportChecks(voicebar, setPermissionState, setRuntimeState, setStatus, false);
    };

    window.addEventListener("focus", refreshOnFocus);

    return () => {
      cancelled = true;
      unsubscribeState();
      unsubscribeCaptured();
      unsubscribeUpdateState();
      unsubscribeOnboardingVerification();
      window.removeEventListener("focus", refreshOnFocus);
      clearAutosaveTimer();
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
      if (capturePending) {
        void voicebar.cancelHotkeyCapture().catch(() => undefined);
      }
    };
  }, [voicebar, saving, capturePending]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    if (!voicebar || windowMode !== "onboarding" || onboardingStep !== ONBOARDING_STEPS.length - 1 || !dictationTestReady) {
      return;
    }

    if (onboardingVerification?.status === "listening" || onboardingVerification?.status === "transcribing") {
      return;
    }

    if (onboardingVerified && onboardingVerification?.status === "passed") {
      return;
    }

    void withTimeout(voicebar.armOnboardingVerification(), 5000, "Arm onboarding verification")
      .then((nextVerification) => {
        setOnboardingVerification(nextVerification);
      })
      .catch((error) => {
        setStatus({ tone: "danger", text: errorToMessage(error) });
      });
  }, [voicebar, windowMode, onboardingStep, dictationTestReady, onboardingVerification?.status, onboardingVerified]);

  useEffect(() => {
    if (!voicebar || !onboardingVerification) {
      return;
    }

    const onVerificationStep = windowMode === "onboarding" && onboardingStep === ONBOARDING_STEPS.length - 1;
    if (onVerificationStep || onboardingVerification.status === "idle" || onboardingVerification.status === "passed") {
      return;
    }

    void voicebar.resetOnboardingVerification()
      .then((nextVerification) => {
        setOnboardingVerification(nextVerification);
      })
      .catch(() => undefined);
  }, [voicebar, onboardingVerification, onboardingStep, windowMode]);

  useEffect(() => {
    if (!onboardingVerification || !onboarding || windowMode !== "onboarding") {
      return;
    }

    if (onboardingVerification.status === "passed" && onboardingVerification.result) {
      if (onboardingVerified) {
        return;
      }

      void updateOnboardingState({
        dictationVerified: true,
        dictationVerifiedAt: Date.now(),
        verifiedModelId: onboardingVerification.result.modelId,
        verifiedShortcut: onboardingVerification.shortcut
      })
        .then(() => {
          setStatus({
            tone: "success",
            text: onboardingVerification.result?.autoPasteEnabled && !onboardingVerification.result.accessibilityReady
              ? "Test passed. Dictation works, but auto-paste still needs Accessibility access."
              : "Test passed. Finish setup when you are ready."
          });
        })
        .catch((error) => {
          setStatus({ tone: "danger", text: errorToMessage(error) });
        });
      return;
    }

    if (onboardingVerification.status === "failed") {
      if (onboarding.dictationVerified) {
        setOnboarding((current) => current ? {
          ...current,
          dictationVerified: false,
          dictationVerifiedAt: undefined,
          verifiedModelId: undefined,
          verifiedShortcut: undefined
        } : current);
        void updateOnboardingState({
          dictationVerified: false,
          dictationVerifiedAt: undefined,
          verifiedModelId: undefined,
          verifiedShortcut: undefined
        }).catch(() => undefined);
      }
      if (onboardingVerification.errorMessage) {
        setStatus({ tone: "danger", text: onboardingVerification.errorMessage });
      }
    }
  }, [onboardingVerification, onboarding, windowMode, onboardingVerified]);

  useEffect(() => {
    if (windowMode !== "settings" || !draft) {
      return;
    }

    if (skipAutosaveRef.current) {
      skipAutosaveRef.current = false;
      return;
    }

    const draftSignature = settingsSignature(draft);
    if (draftSignature === lastSavedSignatureRef.current) {
      return;
    }

    clearAutosaveTimer();
    autosaveTimerRef.current = window.setTimeout(() => {
      void requestSaveRef.current(draft, { toastText: "Changes saved" });
    }, nextAutosaveDelayRef.current);

    return clearAutosaveTimer;
  }, [draft, windowMode]);

  if (!voicebar) {
    return <Shell><EmptyState title="Settings unavailable" text="Restart Vorn Voice to reload the settings window." /></Shell>;
  }

  if (!ready || !draft || !onboarding) {
    return <Shell><EmptyState title="Loading Vorn Voice" text={status.text} /></Shell>;
  }

  const requestSave = async (
    nextSettings: AppSettings,
    options: { statusText?: string; toastText?: string } = {}
  ): Promise<boolean> => {
    const saveSignature = settingsSignature(nextSettings);

    clearAutosaveTimer();
    setSaving(true);
    draftRef.current = nextSettings;
    setDraft(nextSettings);

    try {
      const nextSnapshot = await withTimeout(voicebar.saveSettings(nextSettings), 6000, "Save settings");
      const currentSignature = draftRef.current ? settingsSignature(draftRef.current) : saveSignature;
      const savedSignature = settingsSignature(nextSnapshot.settings);

      lastSavedSignatureRef.current = savedSignature;
      setSnapshot(nextSnapshot);
      if (currentSignature === saveSignature) {
        draftRef.current = nextSnapshot.settings;
        skipAutosaveRef.current = true;
        setDraft(nextSnapshot.settings);
      }
      if (options.statusText) {
        setStatus({ tone: "success", text: options.statusText });
      }
      if (options.toastText) {
        showToast({ tone: "success", text: options.toastText });
      }
      await refreshSupportChecks(voicebar, setPermissionState, setRuntimeState, setStatus, false);
      return true;
    } catch (error) {
      setStatus({ tone: "danger", text: errorToMessage(error) });
      if (options.toastText) {
        showToast({ tone: "danger", text: "Could not save changes." });
      }
      return false;
    } finally {
      setSaving(false);
    }
  };

  requestSaveRef.current = requestSave;

  const saveCurrentDraft = async (successText?: string) => {
    if (!draft) {
      return false;
    }

    return requestSave(draft, { statusText: successText ?? "Saved your settings." });
  };

  const updateOnboardingState = async (partial: Partial<OnboardingState>) => {
    const nextOnboarding = await withTimeout(voicebar.updateOnboardingState(partial), 5000, "Onboarding state");
    setOnboarding(nextOnboarding);
    return nextOnboarding;
  };

  const beginHotkeyCapture = async () => {
    setCapturePending(true);

    try {
      await voicebar.startHotkeyCapture();
      setStatus({ tone: "neutral", text: "Press the shortcut you want to use." });
    } catch (error) {
      setCapturePending(false);
      setStatus({ tone: "danger", text: errorToMessage(error) });
    }
  };

  const cancelHotkeyCapture = async () => {
    setCapturePending(false);
    try {
      await voicebar.cancelHotkeyCapture();
    } catch {
      // ignore
    }
  };

  const installRuntime = async () => {
    setInstallingRuntime(true);

    try {
      const diagnostics = await withTimeout(voicebar.installSpeechRuntime(), 120000, "Install runtime");
      setRuntimeState(diagnostics);
      setStatus({
        tone: diagnostics.whisperCliFound ? "success" : "warning",
        text: diagnostics.whisperCliFound ? "Speech runtime is ready." : "Runtime install finished, but Vorn still cannot find whisper-cli."
      });
    } catch (error) {
      setStatus({ tone: "danger", text: errorToMessage(error) });
    } finally {
      setInstallingRuntime(false);
    }
  };

  const requestMicrophone = async () => {
    try {
      const granted = await voicebar.requestMicrophonePermission();
      await refreshSupportChecks(voicebar, setPermissionState, setRuntimeState, setStatus, false);
      setStatus({
        tone: granted ? "success" : "warning",
        text: granted ? "Microphone access granted." : "Microphone access is still off. Enable it in System Settings if you want hands-free dictation."
      });
    } catch (error) {
      setStatus({ tone: "danger", text: errorToMessage(error) });
    }
  };

  const refreshChecks = async () => {
    await refreshSupportChecks(voicebar, setPermissionState, setRuntimeState, setStatus, true);
  };

  const checkForUpdates = async () => {
    setCheckingForUpdates(true);

    try {
      const nextUpdateState = await withTimeout(voicebar.checkForUpdatesManual(), 15000, "Check for updates");
      setUpdateState(nextUpdateState);
      setStatus({ tone: "neutral", text: nextUpdateState.label });
    } catch (error) {
      setStatus({ tone: "danger", text: errorToMessage(error) });
    } finally {
      setCheckingForUpdates(false);
    }
  };

  const installUpdate = async () => {
    setInstallingUpdate(true);

    try {
      const installStarted = await withTimeout(voicebar.installDownloadedUpdate(), 5000, "Install update");
      if (!installStarted) {
        setStatus({ tone: "warning", text: "No downloaded update is ready to install yet." });
        return;
      }

      setStatus({ tone: "neutral", text: "Restarting app to install update..." });
    } catch (error) {
      setStatus({ tone: "danger", text: errorToMessage(error) });
    } finally {
      setInstallingUpdate(false);
    }
  };

  const openPrivacy = async (pane: "accessibility" | "microphone") => {
    try {
      await voicebar.openPrivacySettings(pane);
      setStatus({ tone: "neutral", text: "System Settings opened. After changing access, come back here and click Refresh checks." });
    } catch (error) {
      setStatus({ tone: "danger", text: errorToMessage(error) });
    }
  };

  const updateDraft = (recipe: (current: AppSettings) => AppSettings, options: DraftUpdateOptions = {}) => {
    let nextDraft: AppSettings | null = null;
    let didChangeVerificationInputs = false;

    setDraft((current) => {
      if (!current) {
        return current;
      }

      const updated = recipe(current);
      if (settingsSignature(updated) === settingsSignature(current)) {
        return current;
      }

      nextDraft = updated;
      didChangeVerificationInputs = current.activeModelId !== updated.activeModelId || !sameShortcut(current.shortcut, updated.shortcut);
      draftRef.current = updated;
      return updated;
    });

    if (nextDraft && windowMode === "settings") {
      skipAutosaveRef.current = false;
      nextAutosaveDelayRef.current = options.immediateSave ? 0 : AUTOSAVE_DELAY_MS;
    }

    if (nextDraft && windowMode === "onboarding" && didChangeVerificationInputs) {
      const verificationReset = {
        dictationVerified: false,
        dictationVerifiedAt: undefined,
        verifiedModelId: undefined,
        verifiedShortcut: undefined
      } satisfies Partial<OnboardingState>;

      setOnboarding((current) => current ? { ...current, ...verificationReset } : current);
      void voicebar.resetOnboardingVerification()
        .then((nextVerification) => {
          setOnboardingVerification(nextVerification);
        })
        .catch(() => undefined);
      void updateOnboardingState(verificationReset).catch(() => undefined);
    }
  };

  const downloadModel = async (modelId: string) => {
    setDownloadModelId(modelId);
    try {
      await voicebar.downloadModel(modelId);
      const listedModels = await voicebar.listModels();
      setModels(listedModels);
      setStatus({ tone: "success", text: "Model installed. Select it when you are ready to use it." });
    } catch (error) {
      setStatus({ tone: "danger", text: errorToMessage(error) });
    } finally {
      setDownloadModelId(null);
    }
  };

  const removeModel = async (modelId: string) => {
    setRemovingModelId(modelId);
    try {
      await voicebar.removeModel(modelId);
      const listedModels = await voicebar.listModels();
      setModels(listedModels);

      if (draft.activeModelId === modelId) {
        const fallback = listedModels.find((model) => model.installed);
        if (fallback) {
          const nextSettings = { ...draft, activeModelId: fallback.id };
          await requestSave(nextSettings, { statusText: "Updated your default model.", toastText: "Changes saved" });
        } else {
          setStatus({ tone: "warning", text: "Model removed. Install another model before dictation can run." });
          return;
        }
      }

      setStatus({ tone: "success", text: "Model removed." });
    } catch (error) {
      setStatus({ tone: "danger", text: errorToMessage(error) });
    } finally {
      setRemovingModelId(null);
    }
  };

  const finishOnboarding = async () => {
    if (!setupReady) {
      setStatus({ tone: "warning", text: "Finish the setup checklist before continuing." });
      return;
    }

    if (!onboardingVerified) {
      setStatus({ tone: "warning", text: "Run a successful test dictation before finishing setup." });
      return;
    }

    setCompletingOnboarding(true);
    try {
      const saved = await saveCurrentDraft("Saved your setup.");
      if (!saved) {
        return;
      }

      const nextOnboarding = await voicebar.completeOnboarding({
        dictationVerified: true,
        dictationVerifiedAt: onboarding.dictationVerifiedAt ?? Date.now(),
        verifiedModelId: draft.activeModelId,
        verifiedShortcut: draft.shortcut
      });
      setOnboarding(nextOnboarding);
      setWindowMode("settings");
      setActiveSettingsTab("overview");
      setStatus({ tone: "success", text: "Setup complete. You can start dictating now." });
    } catch (error) {
      setStatus({ tone: "danger", text: errorToMessage(error) });
    } finally {
      setCompletingOnboarding(false);
    }
  };

  const resetOnboarding = async () => {
    try {
      const [nextOnboarding, nextVerification] = await Promise.all([
        voicebar.resetOnboarding(),
        voicebar.resetOnboardingVerification()
      ]);
      setOnboarding(nextOnboarding);
      setOnboardingVerification(nextVerification);
      setWindowMode("onboarding");
      setOnboardingStep(0);
      setStatus({ tone: "neutral", text: "Setup restarted." });
    } catch (error) {
      setStatus({ tone: "danger", text: errorToMessage(error) });
    }
  };

  return (
    <Shell>
      <div className={cn("mx-auto flex min-h-screen w-full flex-col lg:h-screen lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:overflow-hidden", FULLSCREEN_CONTENT_WIDTH_CLASS)}>
        <aside className="flex min-h-0 shrink-0 flex-col border-b border-[rgba(249,115,22,0.1)] bg-[linear-gradient(180deg,#040404_0%,#050505_36%,#060606_100%)] shadow-[inset_-1px_0_0_rgba(249,115,22,0.06)] lg:h-screen lg:border-b-0 lg:border-r">
          <div className="border-b border-[rgba(249,115,22,0.12)] px-5 py-5 lg:px-6 lg:py-6">
            <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[rgb(var(--accent))]/82">
              <span className="h-2 w-2 rounded-full bg-[rgb(var(--accent))] shadow-[0_0_16px_rgba(249,115,22,0.55)]" />
              Vorn Voice
            </span>
            <h1 className="mt-3 text-[28px] leading-tight tracking-tight text-[rgb(var(--foreground))]">{windowMode === "onboarding" ? "Set up local dictation" : "Settings"}</h1>
            <p className="mt-2 m-0 max-w-xs text-sm leading-relaxed text-[rgb(var(--muted-foreground))]">
              {windowMode === "onboarding"
                ? "Work through the essentials once, then Vorn can stay quietly in your menu bar."
                : "Adjust dictation, models, and system behavior."}
            </p>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-5 lg:px-4 lg:py-6">
            {windowMode === "settings" ? (
              <div className="flex flex-1 flex-col">
                <div className="flex min-h-full flex-1 flex-col rounded-[26px] border border-[rgba(249,115,22,0.1)] bg-[linear-gradient(180deg,rgba(249,115,22,0.03)_0%,rgba(10,10,10,0.98)_18%,#080808_100%)] p-3 shadow-[0_16px_32px_rgba(0,0,0,0.22)]">
                  <div className="px-2.5 pb-3">
                    <span className="text-[11px] uppercase tracking-[0.18em] text-[rgb(var(--accent))]/72">Navigation</span>
                    <p className="mt-2 text-xs leading-relaxed text-[rgb(var(--muted-foreground))]">Choose an area to adjust. Changes save automatically.</p>
                  </div>
                  <nav aria-label="Settings sections" className="flex flex-col gap-1.5">
                    {SETTINGS_TABS.map((tab) => (
                      <SidebarNavButton
                        active={activeSettingsTab === tab.id}
                        key={tab.id}
                        label={tab.label}
                        onClick={() => selectSettingsTab(tab.id)}
                      />
                    ))}
                  </nav>
                </div>
              </div>
            ) : (
              <div className="flex flex-1 flex-col">
                <div className="rounded-[26px] border border-[rgba(249,115,22,0.1)] bg-[linear-gradient(180deg,rgba(249,115,22,0.03)_0%,rgba(10,10,10,0.98)_18%,#080808_100%)] p-3 shadow-[0_16px_32px_rgba(0,0,0,0.22)]">
                  <div className="px-2.5 pb-3">
                    <span className="text-[11px] uppercase tracking-[0.18em] text-[rgb(var(--accent))]/72">Setup</span>
                    <p className="mt-2 text-xs leading-relaxed text-[rgb(var(--muted-foreground))]">Move through each step once to get local dictation ready on this Mac.</p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {ONBOARDING_STEPS.map((step, index) => (
                      <SidebarStepButton
                        active={index === onboardingStep}
                        index={index + 1}
                        key={step}
                        label={step}
                        onClick={() => setOnboardingStep(index)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {windowMode === "onboarding" ? (
              <div className="mt-6 flex flex-col gap-2 lg:mt-auto">
                <span className="px-3.5 text-[11px] uppercase tracking-[0.18em] text-[rgb(var(--accent))]/72">System status</span>
                <div className="rounded-2xl border border-[rgba(249,115,22,0.12)] bg-[linear-gradient(180deg,rgba(249,115,22,0.05)_0%,rgba(7,7,7,0.98)_22%,#060606_100%)] px-4 py-2 shadow-[0_16px_30px_rgba(0,0,0,0.28)]">
                  <SidebarStat label="Model" value={activeModelInstalled ? activeModel?.name ?? "Installed" : installedModels.length > 0 ? "Select one" : "Install one"} tone={activeModelInstalled ? "success" : "warning"} />
                  <SidebarStat label="Installed" value={`${installedModels.length}`} tone={installedModels.length > 0 ? "success" : "warning"} />
                  <SidebarStat label="Runtime" value={runtimeReady ? "Ready" : "Needs install"} tone={runtimeReady ? "success" : "warning"} />
                  <SidebarStat label="Mic" value={microphoneLabel(permissionState)} tone={microphoneGranted ? "success" : "warning"} />
                  <SidebarStat label="Paste" value={draft.autoPaste ? (permissionState?.accessibility ? "Ready" : "Needs access") : "Manual"} tone={accessibilityReady ? "success" : "warning"} />
                </div>
              </div>
            ) : null}
          </div>
        </aside>

        <main ref={settingsContentRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.1),transparent_42%),radial-gradient(circle_at_top,rgba(249,115,22,0.05),transparent_32%),linear-gradient(180deg,#090909,#050505)] [scrollbar-gutter:stable]">
          <div className="flex min-h-full flex-col gap-5 px-3 py-4 sm:px-5 sm:py-5 lg:px-7 lg:py-7 xl:px-9 xl:py-8 xl:pb-12">
            {windowMode === "settings" && toast ? <SaveToast message={toast} /> : null}
            <Card className="relative overflow-hidden rounded-[30px] border-[rgba(249,115,22,0.14)] bg-[linear-gradient(180deg,rgba(16,16,16,0.99)_0%,rgba(12,12,12,0.99)_100%)] shadow-[0_24px_60px_rgba(0,0,0,0.42)]">
              <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-[-8%] w-[34%] bg-[radial-gradient(circle_at_left_center,rgba(249,115,22,0.16),transparent_68%)]" />
              <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[rgba(249,115,22,0.16)]" />
              <CardHeader className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(249,115,22,0.24)] bg-[rgba(249,115,22,0.08)] px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[rgb(var(--accent))]/86">
                    <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--accent))]" />
                    Status
                  </span>
                  <h2 className="mt-2 text-3xl tracking-tight">{setupReady ? "Ready to dictate" : "A few things still need attention"}</h2>
                  <p className="mt-1 text-sm leading-relaxed text-[rgb(var(--muted-foreground))]">{status.text}</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Badge className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium shadow-[0_0_0_1px_rgba(255,255,255,0.02)]", status.tone === "success" ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-200" : status.tone === "warning" ? "border-amber-500/40 bg-amber-950/40 text-amber-200" : status.tone === "danger" ? "border-red-500/40 bg-red-950/40 text-red-200" : "border-[rgba(249,115,22,0.26)] bg-[rgba(249,115,22,0.1)] text-[rgb(var(--accent))]" )} variant="outline">
                    {status.tone === "success" ? "Healthy" : status.tone === "warning" ? "Needs review" : status.tone === "danger" ? "Issue" : "Checking"}
                  </Badge>
                  <Button className="border-[rgba(249,115,22,0.26)] bg-[rgba(249,115,22,0.08)] hover:bg-[rgba(249,115,22,0.14)]" variant="outline" onClick={() => void refreshChecks()} type="button">Refresh checks</Button>
                </div>
              </CardHeader>
            </Card>

            {windowMode === "onboarding" ? (
              <OnboardingView
                accessibilityReady={accessibilityReady}
                activeModelId={draft.activeModelId}
                activeModelInstalled={activeModelInstalled}
                beginHotkeyCapture={beginHotkeyCapture}
                cancelHotkeyCapture={cancelHotkeyCapture}
                capturePending={capturePending}
                completeDisabled={!completeReady || completingOnboarding || saving}
                completingOnboarding={completingOnboarding}
                dictationTestReady={dictationTestReady}
                draft={draft}
                downloadModel={downloadModel}
                downloadModelId={downloadModelId}
                hotkeyReady={hotkeyReady}
                installRuntime={installRuntime}
                installingRuntime={installingRuntime}
                microphoneGranted={microphoneGranted}
                models={models}
                onboardingStep={onboardingStep}
                onboardingVerification={onboardingVerification!}
                onboardingVerified={onboardingVerified}
                openPrivacy={openPrivacy}
                permissionState={permissionState}
                removeModel={removeModel}
                removingModelId={removingModelId}
                requestMicrophone={requestMicrophone}
                runtimeReady={runtimeReady}
                saveCurrentDraft={saveCurrentDraft}
                setDraft={updateDraft}
                setOnboardingStep={setOnboardingStep}
                setupReady={setupReady}
                finishOnboarding={finishOnboarding}
              />
            ) : (
              <SettingsView
                activeTab={activeSettingsTab}
                accessibilityReady={accessibilityReady}
                activeModel={activeModel}
                activeModelInstalled={activeModelInstalled}
                appVersion={appVersion}
                beginHotkeyCapture={beginHotkeyCapture}
                cancelHotkeyCapture={cancelHotkeyCapture}
                capturePending={capturePending}
                checkForUpdates={checkForUpdates}
                checkingForUpdates={checkingForUpdates}
                downloadModel={downloadModel}
                downloadModelId={downloadModelId}
                draft={draft}
                hotkeyReady={hotkeyReady}
                installRuntime={installRuntime}
                installUpdate={installUpdate}
                installingUpdate={installingUpdate}
                installingRuntime={installingRuntime}
                microphoneGranted={microphoneGranted}
                models={models}
                openPrivacy={openPrivacy}
                permissionState={permissionState}
                removeModel={removeModel}
                removingModelId={removingModelId}
                requestMicrophone={requestMicrophone}
                resetOnboarding={resetOnboarding}
                runtimeReady={runtimeReady}
                runtimeState={runtimeState}
                speechStats={speechStats}
                snapshot={snapshot!}
                setDraft={updateDraft}
                updateState={updateState}
              />
            )}
          </div>
        </main>
      </div>
    </Shell>
  );
}

type OnboardingViewProps = {
  accessibilityReady: boolean;
  activeModelId: string;
  activeModelInstalled: boolean;
  beginHotkeyCapture: () => Promise<void>;
  cancelHotkeyCapture: () => Promise<void>;
  capturePending: boolean;
  completeDisabled: boolean;
  completingOnboarding: boolean;
  dictationTestReady: boolean;
  draft: AppSettings;
  downloadModel: (modelId: string) => Promise<void>;
  downloadModelId: string | null;
  finishOnboarding: () => Promise<void>;
  hotkeyReady: boolean;
  installRuntime: () => Promise<void>;
  installingRuntime: boolean;
  microphoneGranted: boolean;
  models: ModelListItem[];
  onboardingStep: number;
  onboardingVerification: OnboardingVerificationState;
  onboardingVerified: boolean;
  openPrivacy: (pane: "accessibility" | "microphone") => Promise<void>;
  permissionState: PermissionsSnapshot | null;
  removeModel: (modelId: string) => Promise<void>;
  removingModelId: string | null;
  requestMicrophone: () => Promise<void>;
  runtimeReady: boolean;
  saveCurrentDraft: (successText?: string) => Promise<boolean>;
  setDraft: (recipe: (current: AppSettings) => AppSettings) => void;
  setOnboardingStep: (step: number) => void;
  setupReady: boolean;
};

function OnboardingView(props: OnboardingViewProps): ReactElement {
  const {
    accessibilityReady,
    activeModelId,
    activeModelInstalled,
    beginHotkeyCapture,
    cancelHotkeyCapture,
    capturePending,
    completeDisabled,
    completingOnboarding,
    dictationTestReady,
    draft,
    downloadModel,
    downloadModelId,
    finishOnboarding,
    hotkeyReady,
    installRuntime,
    installingRuntime,
    microphoneGranted,
    models,
    onboardingStep,
    onboardingVerification,
    onboardingVerified,
    openPrivacy,
    permissionState,
    removeModel,
    removingModelId,
    requestMicrophone,
    runtimeReady,
    saveCurrentDraft,
    setDraft,
    setOnboardingStep,
    setupReady
  } = props;

  const nextStep = async () => {
    const saved = await saveCurrentDraft("Saved this step.");
    if (!saved) {
      return;
    }

    setOnboardingStep(Math.min(onboardingStep + 1, ONBOARDING_STEPS.length - 1));
  };

  const previousStep = () => {
    setOnboardingStep(Math.max(onboardingStep - 1, 0));
  };

  return (
    <div className="flex flex-col gap-3">
      {onboardingStep === 0 ? (
        <Card className={cn(CARD_BASE_CLASS, "p-5 md:p-6")}>
          <SectionHeading title="Choose your model" text="Pick one installed model. Base English is bundled by default, and Small English is available if you want more accuracy." />
          <ModelPanel
            activeModelId={activeModelId}
            downloadModel={downloadModel}
            downloadModelId={downloadModelId}
            models={models}
            onSelect={(modelId) => setDraft((current) => ({ ...current, activeModelId: modelId }))}
            removeModel={removeModel}
            removingModelId={removingModelId}
          />
        </Card>
      ) : null}

      {onboardingStep === 1 ? (
        <Card className={cn(CARD_BASE_CLASS, "p-5 md:p-6")}>
          <SectionHeading title="Enable access" text="Vorn needs the speech runtime, microphone access, and optional Accessibility for auto-paste." />
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <CheckCard
              action={<Button disabled={installingRuntime} variant="outline" onClick={() => void installRuntime()} type="button">{installingRuntime ? "Installing..." : runtimeReady ? "Reinstall runtime" : "Install runtime"}</Button>}
              detail="Runs locally on your Mac. No cloud setup required."
              ready={runtimeReady}
              title="Speech runtime"
            />
            <CheckCard
              action={<Button variant="outline" onClick={() => void requestMicrophone()} type="button">{microphoneGranted ? "Check again" : "Allow microphone"}</Button>}
              detail="Needed to record your voice before transcription begins."
              ready={microphoneGranted}
              title="Microphone"
            />
            <CheckCard
              action={draft.autoPaste ? <Button variant="outline" onClick={() => void openPrivacy("accessibility")} type="button">Open Accessibility</Button> : undefined}
              detail={draft.autoPaste ? "Needed only if you want Vorn to paste into other apps for you." : "You are using manual paste, so this can stay off."}
              ready={accessibilityReady}
              title="Accessibility"
            />
            <CheckCard
              detail={permissionState?.hotkeyMessage ?? "Lets Vorn listen for your global shortcut and stop dictation when you release it."}
              ready={hotkeyReady}
              title="Hotkey monitoring"
            />
          </div>
          {!microphoneGranted ? (
            <p className="mt-3 text-sm text-[rgb(var(--muted-foreground))]">If macOS already asked once and you denied it, use <button className="bg-transparent p-0 text-[rgb(var(--accent))] underline decoration-[rgb(var(--accent))]/60 underline-offset-2" onClick={() => void openPrivacy("microphone")} type="button">Microphone Settings</button> to turn it back on.</p>
          ) : null}
        </Card>
      ) : null}

      {onboardingStep === 2 ? (
        <Card className={cn(CARD_BASE_CLASS, "p-5 md:p-6")}>
          <SectionHeading title="Pick how dictation feels" text="Choose the shortcut and decide whether Vorn pastes automatically or leaves text on your clipboard." />
          <HotkeyPanel
            capturePending={capturePending}
            hotkeyBehavior={draft.hotkeyBehavior}
            onBegin={beginHotkeyCapture}
            onCancel={cancelHotkeyCapture}
            shortcut={draft.shortcut}
          />
          <div className="flex flex-col gap-3">
            <ToggleRow
              checked={draft.hotkeyBehavior === "toggle"}
              detail="Hold records while pressed. Toggle starts on first press and stops on second press."
              label="Press once to start and again to stop"
              onChange={(checked) => setDraft((current) => ({ ...current, hotkeyBehavior: checked ? "toggle" : "hold" }))}
            />
            <ToggleRow
              checked={draft.autoPaste}
              detail="Paste into the frontmost app after transcription finishes."
              label="Auto-paste into my active app"
              onChange={(checked) => setDraft((current) => ({ ...current, autoPaste: checked }))}
            />
            <ToggleRow
              checked={draft.restoreClipboard}
              detail="Put your clipboard back after pasting so you do not lose what you copied earlier."
              label="Restore clipboard after paste"
              onChange={(checked) => setDraft((current) => ({ ...current, restoreClipboard: checked }))}
            />
          </div>
        </Card>
      ) : null}

      {onboardingStep === 3 ? (
        <Card className={cn(CARD_BASE_CLASS, "p-5 md:p-6")}>
          <SectionHeading title="Test and finish" text="Run one live dictation before you leave setup so you know the full local pipeline works on this Mac." />
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <CheckCard detail={activeModelInstalled ? `Selected model: ${draft.activeModelId}` : "Choose and install a model."} ready={activeModelInstalled} title="Model ready" />
            <CheckCard detail={runtimeReady ? "whisper-cli detected." : "Install the local speech runtime."} ready={runtimeReady} title="Runtime ready" />
            <CheckCard detail={microphoneGranted ? "Microphone access granted." : "Microphone access still missing."} ready={microphoneGranted} title="Microphone ready" />
            <CheckCard detail={draft.autoPaste ? (accessibilityReady ? "Accessibility is ready for auto-paste." : "Accessibility is still needed for auto-paste.") : "Accessibility is optional because auto-paste is off."} ready={accessibilityReady} title="Paste behavior" />
          </div>
          <div className={cn("mt-3 flex flex-col gap-3", SUB_PANEL_CLASS)}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <strong>Test dictation</strong>
                <p className="mt-1 text-sm text-[rgb(var(--muted-foreground))]">
                  {onboardingVerificationInstructions(onboardingVerification, draft)}
                </p>
              </div>
              <Badge className={cn("rounded-full", verificationStatusClass(onboardingVerification.status))} variant="outline">
                {verificationStatusLabel(onboardingVerification.status)}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge className={cn("rounded-full", onboardingVerified ? "bg-emerald-600/20 text-emerald-200" : "bg-amber-500/20 text-amber-100")} variant="outline">
                {onboardingVerified ? "Verification passed" : "Verification required"}
              </Badge>
              {draft.autoPaste && !accessibilityReady ? (
                <Badge className="rounded-full bg-amber-500/20 text-amber-100" variant="outline">Auto-paste still needs Accessibility</Badge>
              ) : null}
            </div>
            {onboardingVerification.result ? (
              <div className="rounded-2xl border border-emerald-600/30 bg-emerald-950/20 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="rounded-full bg-emerald-600/20 text-emerald-200" variant="outline">{onboardingVerification.result.wordCount} words</Badge>
                  <Badge className="rounded-full bg-[#111111] text-[rgb(var(--muted-foreground))]" variant="outline">{Math.max(1, Math.round(onboardingVerification.result.durationMs / 100) / 10)}s</Badge>
                  <Badge className="rounded-full bg-[#111111] text-[rgb(var(--muted-foreground))]" variant="outline">Model: {onboardingVerification.result.modelId}</Badge>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-[rgb(var(--foreground))]">{onboardingVerification.result.transcript}</p>
              </div>
            ) : onboardingVerification.errorMessage ? (
              <div className="rounded-2xl border border-amber-700/40 bg-[#1f1310] p-4">
                <strong className="text-sm">Last verification issue</strong>
                <p className="mt-2 text-sm text-[rgb(var(--muted-foreground))]">{onboardingVerification.errorMessage}</p>
              </div>
            ) : (
              <p className="text-sm text-[rgb(var(--muted-foreground))]">A successful shortcut-triggered dictation unlocks the Finish setup button.</p>
            )}
          </div>
          <div className={cn("mt-3 flex flex-col gap-2", SUB_PANEL_CLASS)}>
            <strong>What happens next</strong>
            <p className="text-sm text-[rgb(var(--muted-foreground))]">After this, Vorn can stay in your menu bar. If anything stops working, you can reopen this window from the menu bar icon.</p>
          </div>
        </Card>
      ) : null}

      <footer className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <Button className="bg-transparent text-[rgb(var(--muted-foreground))]" disabled={onboardingStep === 0} variant="outline" onClick={previousStep} type="button">Back</Button>
        {onboardingStep < ONBOARDING_STEPS.length - 1 ? (
          <Button onClick={() => void nextStep()} type="button">Continue</Button>
        ) : (
          <Button disabled={completeDisabled} onClick={() => void finishOnboarding()} type="button">
            {completingOnboarding ? "Finishing..." : "Finish setup"}
          </Button>
        )}
      </footer>
      {!setupReady ? <p className="text-sm text-[rgb(var(--muted-foreground))]">Vorn will keep guiding you here until setup is complete.</p> : null}
      {setupReady && !onboardingVerified ? <p className="text-sm text-[rgb(var(--muted-foreground))]">One successful test dictation is still required before setup can finish.</p> : null}
    </div>
  );
}

type SettingsViewProps = {
  activeTab: SettingsTabId;
  accessibilityReady: boolean;
  activeModel: ModelListItem | undefined;
  activeModelInstalled: boolean;
  appVersion: string;
  beginHotkeyCapture: () => Promise<void>;
  cancelHotkeyCapture: () => Promise<void>;
  capturePending: boolean;
  checkForUpdates: () => Promise<void>;
  checkingForUpdates: boolean;
  downloadModel: (modelId: string) => Promise<void>;
  downloadModelId: string | null;
  draft: AppSettings;
  hotkeyReady: boolean;
  installRuntime: () => Promise<void>;
  installUpdate: () => Promise<void>;
  installingUpdate: boolean;
  installingRuntime: boolean;
  microphoneGranted: boolean;
  models: ModelListItem[];
  openPrivacy: (pane: "accessibility" | "microphone") => Promise<void>;
  permissionState: PermissionsSnapshot | null;
  removeModel: (modelId: string) => Promise<void>;
  removingModelId: string | null;
  requestMicrophone: () => Promise<void>;
  resetOnboarding: () => Promise<void>;
  runtimeReady: boolean;
  runtimeState: SpeechRuntimeDiagnostics | null;
  speechStats: SpeechStats;
  snapshot: AppSnapshot;
  setDraft: (recipe: (current: AppSettings) => AppSettings) => void;
  updateState: UpdateStatus | null;
};

function SettingsView(props: SettingsViewProps): ReactElement {
  const {
    activeTab,
    accessibilityReady,
    activeModel,
    activeModelInstalled,
    appVersion,
    beginHotkeyCapture,
    cancelHotkeyCapture,
    capturePending,
    checkForUpdates,
    checkingForUpdates,
    downloadModel,
    downloadModelId,
    draft,
    hotkeyReady,
    installRuntime,
    installUpdate,
    installingUpdate,
    installingRuntime,
    microphoneGranted,
    models,
    openPrivacy,
    permissionState,
    removeModel,
    removingModelId,
    requestMicrophone,
    resetOnboarding,
    runtimeReady,
    runtimeState,
    speechStats,
    snapshot,
    setDraft,
    updateState
  } = props;

  if (activeTab === "overview") {
    return (
      <OverviewView
        accessibilityReady={accessibilityReady}
        activeModel={activeModel}
        activeModelInstalled={activeModelInstalled}
        draft={draft}
        microphoneGranted={microphoneGranted}
        models={models}
        permissionState={permissionState}
        runtimeReady={runtimeReady}
        speechStats={speechStats}
      />
    );
  }

  if (activeTab === "models") {
    return (
      <SettingsSectionCard
        text="Base English is bundled by default. Install Tiny or Small if you want a different speed or accuracy tradeoff."
        title="Models"
      >
        <ModelPanel
          activeModelId={draft.activeModelId}
          downloadModel={downloadModel}
          downloadModelId={downloadModelId}
          models={models}
          onSelect={(modelId) => setDraft((current) => ({ ...current, activeModelId: modelId }))}
          removeModel={removeModel}
          removingModelId={removingModelId}
        />
      </SettingsSectionCard>
    );
  }

  if (activeTab === "stats") {
    return <StatsView snapshot={snapshot} speechStats={speechStats} />;
  }

  if (activeTab === "advanced") {
    return (
      <SettingsSectionCard
        text="Use these controls when you need to troubleshoot permissions, runtime detection, or update behavior."
        title="Advanced"
      >
        <div className="flex flex-col gap-3">
          <ToggleRow checked={draft.autoUpdateEnabled} detail="Automatically download and install app updates when available." label="Automatic updates" onChange={(checked) => setDraft((current) => ({ ...current, autoUpdateEnabled: checked }))} />
        </div>
        <div className={cn("mt-4", SUB_PANEL_CLASS)}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong className="text-sm">App updates</strong>
            <Badge className={cn(
              "rounded-full",
              updateState?.canInstall
                ? "bg-emerald-600/20 text-emerald-200"
                : updateState?.enabled
                  ? "bg-[#111111] text-[rgb(var(--muted-foreground))]"
                  : "bg-amber-500/20 text-amber-100"
            )} variant="outline">
              {updateState?.canInstall ? "Ready to install" : updateState?.enabled ? "Auto updates on" : "Auto updates off"}
            </Badge>
          </div>
          <p className="mt-2 text-sm text-[rgb(var(--muted-foreground))]">Version {appVersion}</p>
          <p className="mt-2 text-sm text-[rgb(var(--muted-foreground))]">{updateState?.label ?? "Update status unavailable."}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button disabled={checkingForUpdates} variant="outline" onClick={() => void checkForUpdates()} type="button">{checkingForUpdates ? "Checking..." : "Check for updates"}</Button>
            <Button disabled={!updateState?.canInstall || installingUpdate} variant="outline" onClick={() => void installUpdate()} type="button">{installingUpdate ? "Installing..." : "Install downloaded update"}</Button>
          </div>
        </div>
        <div className={cn("mt-4", SUB_PANEL_CLASS)}>
          <strong className="text-sm">Runtime path</strong>
          <p className="mt-2 text-sm text-[rgb(var(--muted-foreground))]">{runtimeState?.whisperCliPath ?? "whisper-cli not found yet."}</p>
        </div>
        {runtimeState?.checkedPaths?.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {runtimeState.checkedPaths.map((checkedPath) => (
              <Badge className={TOKEN_BADGE_CLASS} key={checkedPath} variant="outline">{checkedPath}</Badge>
            ))}
          </div>
        ) : null}
        {permissionState?.hotkeyMessage ? (
          <div className="mt-4 rounded-2xl border border-amber-700/40 bg-[#1f1310] p-4">
            <strong className="text-sm">Hotkey note</strong>
            <p className="mt-2 text-sm text-[rgb(var(--muted-foreground))]">{permissionState.hotkeyMessage}</p>
          </div>
        ) : null}
        <DiagnosticsPanel diagnostics={snapshot.lastSpeechDiagnostics} fallbackRuntimePath={runtimeState?.whisperCliPath} selectedModelName={activeModel?.name ?? draft.activeModelId} />
        <div className="mt-4 flex flex-wrap justify-between gap-3">
          <Button variant="outline" onClick={() => void openPrivacy("microphone")} type="button">Open Microphone Settings</Button>
          <Button className="bg-transparent text-[rgb(var(--muted-foreground))]" variant="outline" onClick={() => void resetOnboarding()} type="button">Run setup again</Button>
        </div>
      </SettingsSectionCard>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <SettingsSectionCard title="General" text="Choose your shortcut and how Vorn should deliver text after transcription.">
        <HotkeyPanel
          capturePending={capturePending}
          hotkeyBehavior={draft.hotkeyBehavior}
          onBegin={beginHotkeyCapture}
          onCancel={cancelHotkeyCapture}
          shortcut={draft.shortcut}
        />
        <div className="flex flex-col gap-3">
          <ToggleRow
            checked={draft.hotkeyBehavior === "toggle"}
            detail="Hold records while pressed. Toggle starts on first press and stops on second press."
            label="Press once to start and again to stop"
            onChange={(checked) => setDraft((current) => ({ ...current, hotkeyBehavior: checked ? "toggle" : "hold" }))}
          />
          <ToggleRow checked={draft.autoPaste} detail="Paste into the frontmost app after each transcript." label="Auto-paste text" onChange={(checked) => setDraft((current) => ({ ...current, autoPaste: checked }))} />
          <ToggleRow checked={draft.restoreClipboard} detail="Restore your clipboard after auto-paste runs." label="Restore clipboard" onChange={(checked) => setDraft((current) => ({ ...current, restoreClipboard: checked }))} />
        </div>
        <section className={cn("mt-4", SUB_PANEL_CLASS)}>
          <SectionHeading compact title="Speech cleanup" text="Balanced keeps your full recording by default. Aggressive trims more silence, while Off sends raw audio to Whisper." />
          <CleanupModeSelector mode={draft.speechCleanupMode} onChange={(mode) => setDraft((current) => ({ ...current, speechCleanupMode: mode }))} />
        </section>
        <section className={cn("mt-4", SUB_PANEL_CLASS)}>
          <SectionHeading compact title="Low-latency capture" text="Keeps a warm local mic stream so speech right after keydown and right before keyup is less likely to clip." />
          <div className="flex flex-col gap-3">
            <ToggleRow checked={draft.lowLatencyCaptureEnabled} detail="Recommended for push-to-talk. Audio stays local and only recent PCM is buffered in memory." label="Enable low-latency capture" onChange={(checked) => setDraft((current) => ({ ...current, lowLatencyCaptureEnabled: checked }))} />
          </div>
          {draft.lowLatencyCaptureEnabled ? (
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm text-[rgb(var(--muted-foreground))]">
                <span>Pre-roll (ms)</span>
                <Input className="h-10" min={0} max={1200} onChange={(event) => {
                  const value = Number(event.target.value);
                  setDraft((current) => ({ ...current, preRollMs: clampCaptureWindow(value, current.preRollMs) }));
                }} type="number" value={draft.preRollMs} />
              </label>
              <label className="flex flex-col gap-2 text-sm text-[rgb(var(--muted-foreground))]">
                <span>Post-roll (ms)</span>
                <Input className="h-10" min={0} max={1200} onChange={(event) => {
                  const value = Number(event.target.value);
                  setDraft((current) => ({ ...current, postRollMs: clampCaptureWindow(value, current.postRollMs) }));
                }} type="number" value={draft.postRollMs} />
              </label>
            </div>
          ) : null}
        </section>
      </SettingsSectionCard>

      <SettingsSectionCard title="Setup status" text="Keep an eye on the essentials here. If these checks are green, dictation should be ready to go.">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <CheckCard detail={activeModelInstalled ? activeModel?.name ?? "Installed" : "Install a model, then select it."} ready={activeModelInstalled} title="Model" />
          <CheckCard action={<Button disabled={installingRuntime} variant="outline" onClick={() => void installRuntime()} type="button">{installingRuntime ? "Installing..." : runtimeReady ? "Reinstall runtime" : "Install runtime"}</Button>} detail={runtimeReady ? "Speech runtime found." : "Needed for local transcription."} ready={runtimeReady} title="Speech runtime" />
          <CheckCard action={<Button variant="outline" onClick={() => void requestMicrophone()} type="button">{microphoneGranted ? "Check again" : "Allow microphone"}</Button>} detail={microphoneGranted ? "Microphone access granted." : "Needed before dictation can start."} ready={microphoneGranted} title="Microphone" />
          <CheckCard action={draft.autoPaste ? <Button variant="outline" onClick={() => void openPrivacy("accessibility")} type="button">Open Accessibility</Button> : undefined} detail={draft.autoPaste ? (accessibilityReady ? "Ready for auto-paste." : "Needed only if auto-paste is enabled.") : "Optional because auto-paste is off."} ready={accessibilityReady} title="Accessibility" />
          <CheckCard detail={permissionState?.hotkeyMessage ?? "Global shortcut monitoring is working."} ready={hotkeyReady} title="Hotkey monitoring" />
        </div>
      </SettingsSectionCard>
    </div>
  );
}

type OverviewViewProps = {
  accessibilityReady: boolean;
  activeModel: ModelListItem | undefined;
  activeModelInstalled: boolean;
  draft: AppSettings;
  microphoneGranted: boolean;
  models: ModelListItem[];
  permissionState: PermissionsSnapshot | null;
  runtimeReady: boolean;
  speechStats: SpeechStats;
};

function OverviewView(props: OverviewViewProps): ReactElement {
  const {
    accessibilityReady,
    activeModel,
    activeModelInstalled,
    draft,
    microphoneGranted,
    models,
    permissionState,
    runtimeReady,
    speechStats
  } = props;
  const installedModelsCount = models.filter((model) => model.installed).length;
  const weeklyWords = wordsThisWeek(speechStats);
  const pasteStatus = draft.autoPaste ? (permissionState?.accessibility ? "Ready" : "Needs access") : "Manual";
  const pasteReady = draft.autoPaste ? accessibilityReady : true;
  const overviewReady = Boolean(activeModelInstalled && runtimeReady && microphoneGranted && pasteReady);
  const overviewTitle = overviewReady ? "Ready to dictate" : "A few things still need attention";
  const overviewText = overviewReady
    ? "Your local setup is in place. Shortcut capture, runtime detection, and your current model are aligned for everyday dictation."
    : "The main dictation path is close, but one or more core pieces still need attention before the app feels frictionless day to day.";

  return (
    <SettingsSectionCard
      text="Quick read on the pieces that matter most for daily dictation on this Mac."
      title="Overview"
    >
      <div className="flex flex-col gap-4">
        <article className="relative overflow-hidden rounded-[28px] border border-[rgba(249,115,22,0.16)] bg-[linear-gradient(180deg,rgba(249,115,22,0.06)_0%,rgba(18,18,18,0.98)_16%,#111111_100%)] p-6 shadow-[0_20px_36px_rgba(0,0,0,0.24)]">
          <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-[-8%] w-[34%] bg-[radial-gradient(circle_at_right_center,rgba(249,115,22,0.14),transparent_72%)]" />
          <div className="relative">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={cn("rounded-full px-3 py-1", overviewReady ? "border-[rgba(249,115,22,0.24)] bg-[rgba(249,115,22,0.1)] text-[rgb(var(--accent))]" : "border-amber-500/35 bg-amber-950/35 text-amber-200")} variant="outline">
                {overviewReady ? "Ready" : "Needs review"}
              </Badge>
              <Badge className="rounded-full border-[rgba(249,115,22,0.16)] bg-[rgba(249,115,22,0.08)] text-[rgb(var(--accent))]" variant="outline">
                Local dictation
              </Badge>
            </div>

            <h3 className="mt-5 max-w-3xl text-[clamp(2.4rem,5vw,3.6rem)] leading-[0.98] tracking-tight text-[rgb(var(--foreground))]">{overviewTitle}</h3>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-[rgb(var(--muted-foreground))]">{overviewText}</p>

            <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <OverviewInsetStat
                detail={activeModelInstalled ? "Selected and ready for transcription." : "Install or select a local model."}
                label="Active model"
                tone={activeModelInstalled ? "success" : "warning"}
                value={activeModelInstalled ? activeModel?.name ?? "Installed" : installedModelsCount > 0 ? "Select one" : "Install one"}
              />
              <OverviewInsetStat
                detail="Rolling 7-day local word count."
                label="Words this week"
                tone="neutral"
                value={formatCount(weeklyWords)}
              />
            </div>
          </div>
        </article>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            className="min-h-[170px]"
            detail={installedModelsCount > 0 ? "Available locally on this Mac." : "No models are installed yet."}
            label="Installed models"
            value={`${installedModelsCount}`}
          />
          <MetricCard
            className="min-h-[170px]"
            detail={runtimeReady ? "whisper-cli detected." : "Install the local speech runtime."}
            emphasize={runtimeReady}
            label="Runtime"
            value={runtimeReady ? "Ready" : "Needs install"}
          />
          <MetricCard
            className="min-h-[170px]"
            detail={microphoneGranted ? "Microphone access granted." : "Permission is still needed."}
            label="Microphone"
            value={microphoneLabel(permissionState)}
          />
          <MetricCard
            className="min-h-[170px]"
            detail={draft.autoPaste ? (accessibilityReady ? "Auto-paste is available." : "Accessibility is still required.") : "Transcripts stay ready for manual paste."}
            label="Paste behavior"
            value={pasteStatus}
          />
        </div>
      </div>
    </SettingsSectionCard>
  );
}

type OverviewInsetStatProps = {
  detail: string;
  label: string;
  tone: StatusTone;
  value: string;
};

function OverviewInsetStat({ detail, label, tone, value }: OverviewInsetStatProps): ReactElement {
  const toneClass: Record<StatusTone, string> = {
    neutral: "text-[rgb(var(--accent))]",
    success: "text-[rgb(var(--accent))]",
    warning: "text-amber-200",
    danger: "text-red-300"
  };

  return (
    <div className="rounded-2xl border border-[rgba(249,115,22,0.12)] bg-[linear-gradient(180deg,rgba(249,115,22,0.03)_0%,rgba(18,18,18,0.98)_18%,#121212_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
      <p className="text-xs uppercase tracking-[0.16em] text-[rgb(var(--muted-foreground))]">{label}</p>
      <strong className={cn("mt-2 block text-2xl tracking-tight", toneClass[tone])}>{value}</strong>
      <p className="mt-2 text-sm leading-relaxed text-[rgb(var(--muted-foreground))]">{detail}</p>
    </div>
  );
}

type SettingsSectionCardProps = {
  children: ReactNode;
  text: string;
  title: string;
};

function SettingsSectionCard({ children, text, title }: SettingsSectionCardProps): ReactElement {
  return (
    <Card className={cn(CARD_BASE_CLASS, "p-5 md:p-6")}>
      <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-6 h-32 w-32 rounded-full bg-[rgba(249,115,22,0.08)] blur-3xl" />
      <div className="relative">
        <SectionHeading text={text} title={title} />
        {children}
      </div>
    </Card>
  );
}

type StatsViewProps = {
  snapshot: AppSnapshot;
  speechStats: SpeechStats;
};

function StatsView({ snapshot, speechStats }: StatsViewProps): ReactElement {
  const weeklyWords = wordsThisWeek(speechStats);
  const avgWpm = Math.round(averageWpm(speechStats));

  return (
    <div className="flex flex-col gap-3">
      <SettingsSectionCard title="Stats" text="All speech stats stay local on this Mac. Lifetime totals update after each completed dictation.">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard detail="Across all finished dictation sessions" emphasize label="Total words" value={formatCount(speechStats.totalWords)} />
          <MetricCard label="Total sessions" value={formatCount(speechStats.sampleCount)} detail="Only completed speech captures count" />
          <MetricCard detail="Weighted across your lifetime usage" emphasize label="Average WPM" value={avgWpm > 0 ? `${avgWpm}` : "-"} />
          <MetricCard label="Words this week" value={formatCount(weeklyWords)} detail="Rolling 7-day local trend" />
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title="Last session" text="Your most recent completed dictation is shown here for quick context.">
        {snapshot.lastSpeechSample ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <MetricCard detail="Most recent dictation" emphasize label="Words" value={formatCount(snapshot.lastSpeechSample.words)} />
            <MetricCard label="Duration" value={formatDurationMs(snapshot.lastSpeechSample.durationMs)} detail="Recorded speech length" />
            <MetricCard label="WPM" value={`${Math.round(snapshot.lastSpeechSample.wpm)}`} detail={formatRecordedAt(snapshot.lastSpeechSample.createdAt)} />
          </div>
        ) : (
          <div className="rounded-2xl border border-[rgb(var(--border))] bg-[#151515] p-5">
            <strong className="text-sm">No dictation sessions yet</strong>
            <p className="mt-2 text-sm text-[rgb(var(--muted-foreground))]">Finish one dictation and this page will start filling in with your local stats.</p>
          </div>
        )}
      </SettingsSectionCard>
    </div>
  );
}

type MetricCardProps = {
  className?: string;
  detail: string;
  emphasize?: boolean;
  label: string;
  value: string;
};

function MetricCard({ className, detail, emphasize = false, label, value }: MetricCardProps): ReactElement {
  return (
    <div className={cn(
      "relative flex h-full flex-col overflow-hidden rounded-2xl border p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]",
      emphasize
        ? "border-[rgba(249,115,22,0.2)] bg-[linear-gradient(180deg,rgba(249,115,22,0.08)_0%,rgba(19,19,19,0.96)_18%,#131313_100%)]"
        : "border-[rgba(249,115,22,0.1)] bg-[linear-gradient(180deg,rgba(249,115,22,0.04)_0%,rgba(19,19,19,0.97)_16%,#131313_100%)]",
      className
    )}>
      <p className={cn("text-sm", emphasize ? "text-[rgb(var(--accent))]/84" : "text-[rgb(var(--muted-foreground))]")}>{label}</p>
      <strong className={cn("mt-3 block text-3xl tracking-tight", emphasize && "text-[rgb(var(--accent))]")}>{value}</strong>
      <p className="mt-auto pt-2 text-sm text-[rgb(var(--muted-foreground))]">{detail}</p>
    </div>
  );
}

type SaveToastProps = {
  message: StatusMessage;
};

function SaveToast({ message }: SaveToastProps): ReactElement {
  const toneClasses: Record<StatusTone, string> = {
    neutral: "border-[rgba(249,115,22,0.3)] bg-[rgba(249,115,22,0.12)] text-[rgb(var(--foreground))]",
    success: "border-emerald-500/40 bg-emerald-950/50 text-emerald-100",
    warning: "border-amber-500/40 bg-amber-950/50 text-amber-100",
    danger: "border-red-500/40 bg-red-950/50 text-red-100"
  };

  return (
    <div className={cn("fixed right-4 top-4 z-50 inline-flex max-w-[min(360px,calc(100vw-32px))] items-center gap-2 rounded-xl border px-3 py-2 text-sm shadow-lg backdrop-blur-sm", toneClasses[message.tone])} role="status">
      <span aria-hidden="true" className="h-2 w-2 rounded-full bg-current" />
      <span>{message.text}</span>
    </div>
  );
}

type ModelPanelProps = {
  activeModelId: string;
  downloadModel: (modelId: string) => Promise<void>;
  downloadModelId: string | null;
  models: ModelListItem[];
  onSelect: (modelId: string) => void;
  removeModel: (modelId: string) => Promise<void>;
  removingModelId: string | null;
};

type CleanupModeSelectorProps = {
  mode: SpeechCleanupMode;
  onChange: (mode: SpeechCleanupMode) => void;
};

const CLEANUP_MODE_DETAILS: Record<SpeechCleanupMode, { description: string; label: string }> = {
  off: {
    label: "Off",
    description: "Send the raw recording to Whisper. Slowest, but safest for soft or distant speech."
  },
  balanced: {
    label: "Balanced",
    description: "Default. Light rumble cleanup without trimming away quiet starts or pauses."
  },
  aggressive: {
    label: "Aggressive",
    description: "Trims more silence before transcription. Best only when your mic is already strong and clear."
  }
};

function ModelPanel(props: ModelPanelProps): ReactElement {
  const { activeModelId, downloadModel, downloadModelId, models, onSelect, removeModel, removingModelId } = props;
  const installedCount = models.filter((model) => model.installed).length;

  return (
    <div className="flex flex-col gap-3">
      {installedCount === 0 ? (
        <div className="rounded-2xl border border-amber-700/40 bg-[#1f1310] p-4">
          <strong className="text-sm">No installed models yet</strong>
          <p className="mt-2 text-sm text-[rgb(var(--muted-foreground))]">Install one model to unlock selection. Uninstalled models stay unavailable until the download finishes.</p>
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      {models.map((model) => {
        const selected = model.installed && model.id === activeModelId;
        const busy = downloadModelId === model.id || removingModelId === model.id;
        const bundled = BUNDLED_MODEL_IDS.includes(model.id);
        const defaultModel = model.id === DEFAULT_MODEL_ID;
        const stateLabel = selected ? "Selected" : model.installed ? "Installed" : "Install";

        return (
          <article className={cn(
            "flex flex-col gap-3 rounded-2xl border bg-[linear-gradient(180deg,rgba(249,115,22,0.04)_0%,rgba(19,19,19,0.97)_18%,#131313_100%)] p-4 transition-all hover:border-[rgba(249,115,22,0.18)] hover:shadow-[0_12px_28px_rgba(0,0,0,0.22)]",
            selected
              ? "border-[rgb(var(--accent))]/70 shadow-[inset_0_0_0_1px_rgba(249,115,22,0.38),0_18px_36px_rgba(0,0,0,0.28)]"
              : "border-[rgba(249,115,22,0.1)]"
          )} key={model.id}>
            <div className="flex items-start justify-between gap-3">
              <strong className="text-base">{model.name}</strong>
              <div className="flex flex-wrap justify-end gap-2">
                {defaultModel ? <Badge variant="default">Bundled default</Badge> : null}
                {bundled && !defaultModel ? <Badge className="border-[rgba(249,115,22,0.18)] text-[rgb(var(--accent))]" variant="outline">Bundled</Badge> : null}
                <Badge className={cn(selected && "bg-[rgba(249,115,22,0.18)] text-[rgb(var(--foreground))]")} variant={selected || model.installed ? "secondary" : "outline"}>{stateLabel}</Badge>
              </div>
            </div>
            <div>
              <p className="text-sm text-[rgb(var(--muted-foreground))]">{model.details}</p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {model.installed ? (
                <>
                  <Button disabled={selected || busy} size="sm" onClick={() => onSelect(model.id)} type="button">{selected ? "Selected" : "Select"}</Button>
                  <Button disabled={busy} size="sm" variant="outline" onClick={() => void removeModel(model.id)} type="button">{busy ? "Working..." : "Remove"}</Button>
                </>
              ) : (
                <Button disabled={busy} size="sm" onClick={() => void downloadModel(model.id)} type="button">{busy ? "Installing..." : "Install"}</Button>
              )}
            </div>
          </article>
        );
      })}
      </div>
    </div>
  );
}

type HotkeyPanelProps = {
  capturePending: boolean;
  hotkeyBehavior: AppSettings["hotkeyBehavior"];
  onBegin: () => Promise<void>;
  onCancel: () => Promise<void>;
  shortcut: KeyboardShortcut;
};

function HotkeyPanel({ capturePending, hotkeyBehavior, onBegin, onCancel, shortcut }: HotkeyPanelProps): ReactElement {
  const helpText = hotkeyBehavior === "toggle"
    ? "Press this shortcut once to record. Press it again to transcribe."
    : "Hold this shortcut to record. Release it to transcribe.";

  return (
    <section className={cn("mb-4", SUB_PANEL_CLASS)}>
      <SectionHeading title="Shortcut" text={helpText} compact />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <span className={cn(
          "inline-flex min-w-[170px] items-center justify-center rounded-full border px-4 py-2 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]",
          capturePending
            ? "border-[rgba(249,115,22,0.28)] bg-[rgba(249,115,22,0.12)] text-[rgb(var(--accent))]"
            : "border-[rgba(249,115,22,0.16)] bg-[linear-gradient(180deg,rgba(249,115,22,0.04),#111111)]"
        )}>{capturePending ? "Listening for keys..." : shortcut.display ?? "Not set"}</span>
        {capturePending ? (
          <Button className="border-[rgba(249,115,22,0.26)] hover:bg-[rgba(249,115,22,0.12)]" variant="outline" onClick={() => void onCancel()} type="button">Cancel</Button>
        ) : (
          <Button className="border-[rgba(249,115,22,0.26)] hover:bg-[rgba(249,115,22,0.12)]" variant="outline" onClick={() => void onBegin()} type="button">Change shortcut</Button>
        )}
      </div>
    </section>
  );
}

function CleanupModeSelector({ mode, onChange }: CleanupModeSelectorProps): ReactElement {
  const safeMode: SpeechCleanupMode = typeof mode === "string" && Object.hasOwn(CLEANUP_MODE_DETAILS, mode)
    ? mode as SpeechCleanupMode
    : "balanced";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(CLEANUP_MODE_DETAILS) as SpeechCleanupMode[]).map((option) => (
          <Button
            key={option}
            className={cn(
              "hover:border-[rgba(249,115,22,0.28)] hover:bg-[rgba(249,115,22,0.08)]",
              safeMode === option && "border-[rgba(249,115,22,0.28)] bg-[linear-gradient(180deg,rgba(249,115,22,0.12),rgba(249,115,22,0.04))] text-[rgb(var(--foreground))]"
            )}
            size="sm"
            variant="outline"
            onClick={() => onChange(option)}
            type="button"
          >
            {CLEANUP_MODE_DETAILS[option].label}
          </Button>
        ))}
      </div>
      <p className="text-sm text-[rgb(var(--muted-foreground))]">{CLEANUP_MODE_DETAILS[safeMode].description}</p>
    </div>
  );
}

type ToggleRowProps = {
  checked: boolean;
  detail: string;
  label: string;
  onChange: (checked: boolean) => void;
};

function ToggleRow({ checked, detail, label, onChange }: ToggleRowProps): ReactElement {
  return (
    <label className={cn(
      "flex items-start justify-between gap-4 rounded-2xl border px-4 py-3 transition-all hover:border-[rgba(249,115,22,0.28)] hover:shadow-[0_10px_24px_rgba(0,0,0,0.18)]",
      checked
        ? "border-[rgba(249,115,22,0.22)] bg-[linear-gradient(180deg,rgba(249,115,22,0.08),rgba(20,20,20,0.97)_20%,#131313)]"
        : "border-[rgba(249,115,22,0.1)] bg-[linear-gradient(180deg,rgba(249,115,22,0.03),rgba(20,20,20,0.97)_16%,#131313)]"
    )}>
      <div className="flex flex-col gap-1">
        <strong className="text-sm">{label}</strong>
        <p className="text-sm text-[rgb(var(--muted-foreground))]">{detail}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

type CheckCardProps = {
  action?: ReactElement;
  detail: string;
  ready: boolean;
  title: string;
};

function CheckCard({ action, detail, ready, title }: CheckCardProps): ReactElement {
  return (
    <article className={cn(
      "relative flex h-full flex-col gap-3 overflow-hidden rounded-2xl border bg-[linear-gradient(180deg,rgba(249,115,22,0.04)_0%,rgba(20,20,20,0.97)_18%,#131313_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]",
      ready ? "border-emerald-600/40" : "border-amber-600/40"
    )}>
      <div className="flex items-center justify-between gap-2">
        <strong className="text-sm">{title}</strong>
        <Badge className={cn("rounded-full", ready ? "bg-emerald-600/20 text-emerald-200" : "bg-amber-500/20 text-amber-100")} variant="outline">{ready ? "Ready" : "Needs attention"}</Badge>
      </div>
      <p className="text-sm text-[rgb(var(--muted-foreground))]">{detail}</p>
      {action ? <div className="mt-auto">{action}</div> : null}
    </article>
  );
}

type DiagnosticsPanelProps = {
  diagnostics?: SpeechPipelineDiagnostics;
  fallbackRuntimePath?: string;
  selectedModelName: string;
};

function DiagnosticsPanel({ diagnostics, fallbackRuntimePath, selectedModelName }: DiagnosticsPanelProps): ReactElement {
  if (!diagnostics) {
    return (
      <div className={cn("mt-4", SUB_PANEL_CLASS)}>
        <strong className="text-sm">Last dictation diagnostics</strong>
        <p className="mt-2 text-sm text-[rgb(var(--muted-foreground))]">After your next dictation, Vorn will show how much cleanup ran, whether chunking kicked in, and which runtime and model were used.</p>
      </div>
    );
  }

  const capture = diagnostics.capture;
  const transcription = diagnostics.transcription;

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className={cn(SUB_PANEL_CLASS, diagnostics.lastError && "border-amber-700/40 bg-[#1f1310]")}>
        <strong className="text-sm">Last dictation diagnostics</strong>
        <p className="mt-2 text-sm text-[rgb(var(--muted-foreground))]">
          {diagnostics.lastError
            ? diagnostics.lastError
            : `Cleanup ran in ${capture?.appliedCleanupMode ?? diagnostics.requestedCleanupMode} mode and ${transcription?.chunked ? `used ${transcription.chunkCount} chunks` : "stayed in a single Whisper pass"}.`}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge className={TOKEN_BADGE_CLASS} variant="outline">Requested cleanup: {diagnostics.requestedCleanupMode}</Badge>
        {capture ? <Badge className={TOKEN_BADGE_CLASS} variant="outline">Applied cleanup: {capture.appliedCleanupMode}</Badge> : null}
        {capture ? <Badge className={TOKEN_BADGE_CLASS} variant="outline">Fallback: {capture.fallbackUsed ? "Yes" : "No"}</Badge> : null}
        {capture ? <Badge className={TOKEN_BADGE_CLASS} variant="outline">Capture backend: {capture.captureBackend}</Badge> : null}
        {capture ? <Badge className={TOKEN_BADGE_CLASS} variant="outline">Raw length: {formatSeconds(capture.raw.durationSeconds)}</Badge> : null}
        {capture ? <Badge className={TOKEN_BADGE_CLASS} variant="outline">Final length: {formatSeconds(capture.final.durationSeconds)}</Badge> : null}
        {capture ? <Badge className={TOKEN_BADGE_CLASS} variant="outline">Raw RMS: {capture.raw.rmsAmplitude.toFixed(4)}</Badge> : null}
        {capture ? <Badge className={TOKEN_BADGE_CLASS} variant="outline">Final RMS: {capture.final.rmsAmplitude.toFixed(4)}</Badge> : null}
        {capture && typeof capture.preRollMsRequested === "number" ? <Badge className={TOKEN_BADGE_CLASS} variant="outline">Pre-roll: {capture.preRollMsDelivered ?? 0}/{capture.preRollMsRequested}ms</Badge> : null}
        {capture && typeof capture.postRollMsRequested === "number" ? <Badge className={TOKEN_BADGE_CLASS} variant="outline">Post-roll: {capture.postRollMsDelivered ?? 0}/{capture.postRollMsRequested}ms</Badge> : null}
        {capture && typeof capture.keydownToCaptureReadyMs === "number" ? <Badge className={TOKEN_BADGE_CLASS} variant="outline">Start latency: {capture.keydownToCaptureReadyMs}ms</Badge> : null}
        {capture && typeof capture.keyupToCaptureStoppedMs === "number" ? <Badge className={TOKEN_BADGE_CLASS} variant="outline">Stop latency: {capture.keyupToCaptureStoppedMs}ms</Badge> : null}
        {transcription ? <Badge className={TOKEN_BADGE_CLASS} variant="outline">Chunking: {transcription.chunked ? `${transcription.chunkCount} chunks` : "Single pass"}</Badge> : null}
        {transcription ? <Badge className={TOKEN_BADGE_CLASS} variant="outline">Blank chunks: {transcription.blankChunkCount}</Badge> : null}
        <Badge className={TOKEN_BADGE_CLASS} variant="outline">Model: {transcription?.modelId ?? selectedModelName}</Badge>
        <Badge className={TOKEN_BADGE_CLASS} variant="outline">Runtime: {transcription?.runtimePath ?? fallbackRuntimePath ?? "Unknown"}</Badge>
      </div>
    </div>
  );
}

type SectionHeadingProps = {
  compact?: boolean;
  text: string;
  title: string;
};

function SectionHeading({ compact = false, text, title }: SectionHeadingProps): ReactElement {
  return (
    <div className={cn("mb-4 flex flex-col gap-1", compact && "mb-3")}>
      <h3 className="text-xl font-semibold tracking-tight">{title}</h3>
      <p className="text-sm text-[rgb(var(--muted-foreground))]">{text}</p>
    </div>
  );
}

type SidebarStatProps = {
  label: string;
  tone: StatusTone;
  value: string;
};

function SidebarStat({ label, tone, value }: SidebarStatProps): ReactElement {
  const toneClass: Record<StatusTone, string> = {
    neutral: "text-[rgb(var(--accent))]",
    success: "text-emerald-400",
    warning: "text-amber-300",
    danger: "text-red-400"
  };

  return (
    <div className="flex items-center justify-between gap-3 border-b border-[rgba(249,115,22,0.08)] py-2.5 last:border-b-0">
      <span className="text-sm text-[rgb(var(--muted-foreground))]">{label}</span>
      <strong className={cn("text-right text-sm font-medium", toneClass[tone])}>{value}</strong>
    </div>
  );
}

type SidebarNavButtonProps = {
  active: boolean;
  label: string;
  onClick: () => void;
};

function SidebarNavButton({ active, label, onClick }: SidebarNavButtonProps): ReactElement {
  return (
    <button
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex min-h-11 w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-[15px] font-medium transition-all lg:min-h-[52px]",
        active
          ? "bg-[linear-gradient(90deg,rgba(249,115,22,0.12)_0%,rgba(249,115,22,0.03)_100%)] text-[rgb(var(--foreground))] shadow-[inset_0_0_0_1px_rgba(249,115,22,0.18)]"
          : "text-[rgb(var(--muted-foreground))] hover:bg-[rgba(249,115,22,0.05)] hover:text-[rgb(var(--foreground))]"
      )}
      onClick={onClick}
      type="button"
    >
      <span className={cn(
        "h-2 w-2 shrink-0 rounded-full transition-all",
        active
          ? "bg-[rgb(var(--accent))] shadow-[0_0_16px_rgba(249,115,22,0.55)]"
          : "bg-[#2a2a2a] group-hover:bg-[rgba(249,115,22,0.72)]"
      )} />
      <span className="truncate">{label}</span>
    </button>
  );
}

type SidebarStepButtonProps = {
  active: boolean;
  index: number;
  label: string;
  onClick: () => void;
};

function SidebarStepButton({ active, index, label, onClick }: SidebarStepButtonProps): ReactElement {
  return (
    <button
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-sm transition-all lg:min-h-[52px]",
        active
          ? "bg-[linear-gradient(90deg,rgba(249,115,22,0.12)_0%,rgba(249,115,22,0.03)_100%)] text-[rgb(var(--foreground))] shadow-[inset_0_0_0_1px_rgba(249,115,22,0.18)]"
          : "text-[rgb(var(--muted-foreground))] hover:bg-[rgba(249,115,22,0.05)] hover:text-[rgb(var(--foreground))]"
      )}
      onClick={onClick}
      type="button"
    >
      <span
        className={cn(
          "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
          active
            ? "border-[rgba(249,115,22,0.34)] bg-[rgba(249,115,22,0.14)] text-[rgb(var(--foreground))]"
            : "border-[#262626] bg-[#080808] text-[rgb(var(--muted-foreground))]"
        )}
      >
        {index}
      </span>
      <strong className="truncate font-medium">{label}</strong>
    </button>
  );
}

type ShellProps = {
  children: ReactElement;
};

function Shell({ children }: ShellProps): ReactElement {
  return <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.08),transparent_36%),radial-gradient(circle_at_top,rgba(249,115,22,0.04),transparent_26%),linear-gradient(180deg,#050505,#090909)] text-[rgb(var(--foreground))]">{children}</div>;
}

type EmptyStateProps = {
  text: string;
  title: string;
};

function EmptyState({ text, title }: EmptyStateProps): ReactElement {
  return (
    <div className="mx-auto mt-20 flex max-w-lg flex-col gap-3 rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] p-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-[rgb(var(--muted-foreground))]">{text}</p>
    </div>
  );
}

async function loadCriticalSettingsData(voicebar: NonNullable<Window["voicebar"]>): Promise<CriticalSettingsData> {
  const [snapshot, models, speechStats] = await Promise.all([
    withTimeout(voicebar.getState(), 5000, "App state"),
    withTimeout(voicebar.listModels(), 5000, "Model list"),
    withTimeout(voicebar.getSpeechStats(), 5000, "Speech stats")
  ]);

  return { snapshot, models, speechStats };
}

async function loadSupportChecks(voicebar: NonNullable<Window["voicebar"]>): Promise<SupportChecksData> {
  const results = await Promise.allSettled([
    withTimeout(voicebar.checkPermissions(), 4500, "Permissions"),
    withTimeout(voicebar.getSpeechRuntimeDiagnostics(), 4500, "Runtime")
  ]);

  const [permissionResult, runtimeResult] = results;
  const errors: string[] = [];

  return {
    permission: permissionResult.status === "fulfilled" ? permissionResult.value : collectSupportError(errors, permissionResult.reason, "Could not refresh permissions."),
    runtime: runtimeResult.status === "fulfilled" ? runtimeResult.value : collectSupportError(errors, runtimeResult.reason, "Could not refresh runtime status."),
    errors
  };
}

async function refreshSupportChecks(
  voicebar: NonNullable<Window["voicebar"]>,
  setPermissionState: (value: PermissionsSnapshot | null) => void,
  setRuntimeState: (value: SpeechRuntimeDiagnostics | null) => void,
  setStatus: (value: StatusMessage) => void,
  announceSuccess: boolean
): Promise<void> {
  const support = await loadSupportChecks(voicebar);

  if (support.permission) {
    setPermissionState(support.permission);
  }

  if (support.runtime) {
    setRuntimeState(support.runtime);
  }

  if (support.errors.length > 0) {
    setStatus({ tone: "warning", text: support.errors[0] });
    return;
  }

  if (announceSuccess) {
    setStatus({ tone: "neutral", text: "Checks refreshed." });
  }
}

function collectSupportError<T>(errors: string[], error: unknown, fallback: string): T | undefined {
  errors.push(errorToMessage(error, fallback));
  return undefined;
}

function settingsSignature(settings: AppSettings): string {
  return JSON.stringify(settings);
}

function getVoicebarApi(): Window["voicebar"] | undefined {
  return window.voicebar;
}

function parseWindowMode(): SettingsWindowMode {
  const search = new URLSearchParams(window.location.search);
  return search.get("mode") === "onboarding" ? "onboarding" : "settings";
}

function onboardingVerificationInstructions(state: OnboardingVerificationState, settings: AppSettings): string {
  switch (state.status) {
    case "listening":
      return "Listening now. Speak naturally, then finish with the same shortcut behavior you chose.";
    case "transcribing":
      return "Transcribing your verification phrase now.";
    case "passed":
      return "That shortcut run worked. Review the transcript below, then finish setup.";
    case "failed":
      return state.errorMessage ?? "That try did not complete. Use your shortcut again after fixing the issue.";
    case "armed":
      return `Use ${settings.shortcut.display ?? "your shortcut"} exactly the way you plan to dictate every day.`;
    default:
      return `When you reach this step, Vorn waits for ${settings.shortcut.display ?? "your shortcut"} to start the live verification run.`;
  }
}

function verificationStatusLabel(status: OnboardingVerificationState["status"]): string {
  switch (status) {
    case "armed":
      return "Waiting for shortcut";
    case "listening":
      return "Listening";
    case "transcribing":
      return "Transcribing";
    case "passed":
      return "Passed";
    case "failed":
      return "Try again";
    default:
      return "Stand by";
  }
}

function verificationStatusClass(status: OnboardingVerificationState["status"]): string {
  switch (status) {
    case "passed":
      return "bg-emerald-600/20 text-emerald-200";
    case "failed":
      return "bg-red-500/20 text-red-200";
    case "listening":
    case "transcribing":
      return "bg-[rgb(var(--accent))]/15 text-[rgb(var(--foreground))]";
    case "armed":
      return "bg-[#111111] text-[rgb(var(--muted-foreground))]";
    default:
      return "bg-[#111111] text-[rgb(var(--muted-foreground))]";
  }
}

function sameShortcut(left?: KeyboardShortcut, right?: KeyboardShortcut): boolean {
  if (!left || !right) {
    return false;
  }

  if (left.keyCode !== right.keyCode || left.modifiers.length !== right.modifiers.length) {
    return false;
  }

  return left.modifiers.every((modifier, index) => modifier === right.modifiers[index]);
}

function microphoneLabel(permissionState: PermissionsSnapshot | null): string {
  if (!permissionState) {
    return "Checking";
  }

  switch (permissionState.microphone) {
    case "granted":
      return "Granted";
    case "not-determined":
      return "Ask me";
    case "denied":
      return "Denied";
    case "restricted":
      return "Restricted";
    default:
      return "Review";
  }
}

function errorToMessage(error: unknown, fallback = "Something went wrong."): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatDurationMs(value: number): string {
  if (value < 60000) {
    return `${Math.max(1, Math.round(value / 100) / 10)}s`;
  }

  const minutes = value / 60000;
  return `${minutes.toFixed(minutes >= 10 ? 0 : 1)}m`;
}

function formatRecordedAt(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatSeconds(value: number): string {
  return `${value.toFixed(1)}s`;
}


function clampCaptureWindow(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(1200, Math.max(0, Math.round(value)));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error(`${label} took too long.`));
    }, timeoutMs);

    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      }
    );
  });
}
