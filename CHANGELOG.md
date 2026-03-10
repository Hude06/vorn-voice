# Changelog

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
