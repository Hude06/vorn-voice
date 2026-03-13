# Changelog

## 2026-03-13

- Expand Vorn Voice from a macOS-only menu bar app into a broader desktop release target by adding Windows packaging, platform-specific deploy commands, runtime asset manifests, and platform-aware default shortcuts and shell copy.
- Refactor speech runtime discovery so `whisper-cli` and `sox` are both tracked as required runtime tools, with richer diagnostics, platform-aware executable resolution, improved packaged-runtime recovery messaging, and safer child-process shutdown for capture and transcription commands.
- Generalize permissions and auto-paste handling across platforms with typed system-settings targets, microphone preflight states, Windows PowerShell paste automation support, and clearer user-facing guidance when microphone or paste access is blocked.
- Rework settings and onboarding bootstrap to load critical data first, tolerate optional-data failures, treat hotkey behavior as part of onboarding verification, and polish the settings window for desktop use with platform-aware onboarding guidance and window chrome.
- Harden persistence and migration by refusing to overwrite unreadable settings or speech-stats files, importing legacy `voicebar` and `Voicebar` data when possible, and preserving onboarding verification metadata for the active shortcut and hotkey mode.
- Stop assuming a bundled default model on first run, improve model lookup/removal across legacy storage locations, and broaden regression coverage for onboarding helpers, bootstrap resilience, Windows runtime behavior, process termination, IPC payloads, and storage migration paths.

## 2026-03-10

- Redesign the settings window into a left-tab layout so General, Models, Stats, and Advanced pages feel like a native desktop app while keeping the existing Vorn theme.
- Add a local-only speech stats store and renderer bridge so lifetime totals and the latest session are available inside settings.
- Add regression coverage for speech stats recording, IPC stats loading, and startup wiring for the new stats store.

## 2026-03-09

- Replace the menu bar mark with a smaller icon-only waveform that fits cleanly within a single macOS status item slot.
- Add a subtle animated recording waveform in the menu bar while speech capture is active, with a static idle waveform for non-recording states.
- Move mode feedback from the menu bar title into the tray tooltip so the status item stays compact and modern.
- Stop tray animation cleanly on app shutdown.

## 2026-03-08

- Fix a hold-to-talk race where releasing the hotkey during the macOS microphone permission prompt could still start recording after permission was granted.
- Add a coordinator regression test that verifies capture does not start when release happens while microphone permission is still pending.
- Fix settings launch-state persistence so `ui.hasSeenPostOnboardingWindow` is loaded correctly and relaunch behavior respects the saved flag.
- Fix long transcript auto-paste chunking to preserve boundary whitespace and avoid merged words across chunk splits.
- Harden IPC `settings:save` payload handling by sanitizing malformed values before applying runtime settings.
- Improve hotkey hook recovery by allowing explicit retries after transient hook startup failures.
- Add regression tests for settings launch-state persistence, paste chunk text integrity, and IPC settings sanitization.
