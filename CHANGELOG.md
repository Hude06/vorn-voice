# Changelog

## 2026-03-08

- Fix a hold-to-talk race where releasing the hotkey during the macOS microphone permission prompt could still start recording after permission was granted.
- Add a coordinator regression test that verifies capture does not start when release happens while microphone permission is still pending.
- Fix settings launch-state persistence so `ui.hasSeenPostOnboardingWindow` is loaded correctly and relaunch behavior respects the saved flag.
- Fix long transcript auto-paste chunking to preserve boundary whitespace and avoid merged words across chunk splits.
- Harden IPC `settings:save` payload handling by sanitizing malformed values before applying runtime settings.
- Improve hotkey hook recovery by allowing explicit retries after transient hook startup failures.
- Add regression tests for settings launch-state persistence, paste chunk text integrity, and IPC settings sanitization.
