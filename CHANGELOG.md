# Changelog

## 2026-03-08

- Fix a hold-to-talk race where releasing the hotkey during the macOS microphone permission prompt could still start recording after permission was granted.
- Add a coordinator regression test that verifies capture does not start when release happens while microphone permission is still pending.
