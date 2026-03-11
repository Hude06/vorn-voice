# PREDEPLOY

Final whole-app review checklist for Vorn Voice.

This is the last confidence pass to catch issues that would make the app feel broken, unstable, or not ready to ship after large changes.

## Purpose

Run this after major UI, main-process, native integration, onboarding, model/runtime, or packaging changes.

Use it to answer one question:

- Is the app ready to ship with confidence?

## Exit Criteria

Do not ship if any of these are true:

- Typecheck fails
- Tests fail
- The app crashes, hangs, or shows broken window states
- Dictation does not reliably start, transcribe, or complete
- Permissions are broken or misleading
- Auto-paste / clipboard behavior is broken
- Settings changes do not persist correctly
- A packaged app is missing required runtime/model assets
- A major regression is found in tray, overlay, onboarding, or settings flows

## Always Run

Run these every time:

```bash
npm run typecheck
npm test
npm run start
```

What these cover:

- Type safety across main + renderer
- Existing regression suite in `Tests/**/*.test.ts`
- A built app smoke path instead of only dev/Vite behavior

## Run When Relevant

Run these targeted checks when the touched area matches:

### Dictation lifecycle / onboarding / paste / hotkeys

```bash
npm test -- Tests/coordinator.test.ts
npm test -- Tests/shortcuts.test.ts
npm test -- Tests/pasteService.test.ts
npm test -- Tests/settingsStore.test.ts
```

### Audio capture / silence / long recordings / runtime behavior

```bash
npm test -- Tests/audioCaptureService.test.ts
npm test -- Tests/whisperService.test.ts
npm test -- Tests/modelCatalog.test.ts
```

### Settings, tray, overlay, startup, window loading

```bash
npm test -- Tests/main.test.ts
npm test -- Tests/windowLoading.test.ts
npm test -- Tests/ipcHandlers.test.ts
```

### Updates

```bash
npm test -- Tests/updateService.test.ts
```

### Stats / counters

```bash
npm test -- Tests/speechStats.test.ts
```

## Manual Smoke Checklist

### Core app flow

- [ ] Launch app successfully
- [ ] Tray/menu bar icon appears correctly
- [ ] Open settings from tray
- [ ] Close and reopen settings without broken state
- [ ] Overlay appears when dictation starts
- [ ] Overlay returns to idle after completion/cancel

### First-run / onboarding

- [ ] Onboarding opens when expected
- [ ] Runtime readiness/install flow is clear
- [ ] Base model is available or install flow works
- [ ] Microphone permission prompt works
- [ ] Hotkey capture works
- [ ] Verification step succeeds
- [ ] Completing onboarding persists and returns to normal settings mode

### Dictation

- [ ] Hold-to-talk works
- [ ] Toggle mode works
- [ ] Short dictation works
- [ ] Longer dictation works
- [ ] Silence / no-speech case behaves gracefully
- [ ] App returns to ready state after errors or cancellation

### Paste and clipboard

- [ ] Auto-paste off behaves correctly
- [ ] Auto-paste on behaves correctly
- [ ] Accessibility denied path is understandable
- [ ] Accessibility granted path works
- [ ] Clipboard restore works when enabled

### Settings UI

- [ ] Settings window opens without white flash or blank frame
- [ ] Left nav is readable and easy to use
- [ ] Tab switching does not preserve bad scroll positions
- [ ] Autosave works
- [ ] Status cards reflect real state
- [ ] Advanced actions are available and understandable
- [ ] Stats page renders correctly
- [ ] Model management UI behaves correctly

### Models and runtime

- [ ] Active model is clearly shown
- [ ] Install model works
- [ ] Remove model works
- [ ] Switching models works
- [ ] Runtime missing/error state is handled well
- [ ] App can still use the bundled default model path when needed

### Permissions and native integrations

- [ ] Microphone denied path is clear
- [ ] Microphone granted path works
- [ ] Accessibility denied path is clear
- [ ] Global hotkey still works after settings changes
- [ ] Tray state stays in sync with recording/transcribing status

## Packaged-App Checks

Run these for ship candidates, native/runtime changes, update changes, or packaging changes.

```bash
npm run package:mac:local
npm run verify:codesign:mac
npm run verify:gatekeeper:mac
```

Then manually verify:

- [ ] Packaged app launches successfully
- [ ] Tray works in packaged app
- [ ] Settings window loads correctly
- [ ] Overlay works in packaged app
- [ ] Dictation works in packaged app
- [ ] Bundled runtime assets are present
- [ ] Bundled base model is usable
- [ ] No missing-resource errors appear

## Update Checks

Only run when update logic or feed/version handling changed.

Things to verify:

- [ ] Update UI state is correct
- [ ] Manual check-for-updates action behaves correctly
- [ ] Packaged-only update behavior is respected
- [ ] No broken messaging when running unpackaged/dev builds

## Highest-Risk Areas

Bias extra attention toward these files and flows when they change:

- `src/main/coordinator.ts`
- `src/main/services/audioCaptureService.ts`
- `src/main/services/whisperService.ts`
- `src/main/services/pasteService.ts`
- `src/main/services/permissionService.ts`
- `src/main/services/updateService.ts`
- `src/main/tray.ts`
- `src/main/windows/settingsWindow.ts`
- `src/main/windows/overlayWindow.ts`
- `src/renderer/settings/SettingsApp.tsx`

## Findings Template

Use this after every predeploy review.

```md
# Pre-ship Report

Date:
Tester:
Branch:
Commit:
Machine / macOS:

## Commands Run
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run start`
- [ ] Other:

## Manual Checks
- [ ] Core launch / tray
- [ ] Onboarding
- [ ] Dictation
- [ ] Paste / clipboard
- [ ] Settings UI
- [ ] Models / runtime
- [ ] Permissions
- [ ] Packaged app
- [ ] Updates

## Blockers
- None / list each issue with:
  - Area:
  - Repro:
  - Expected:
  - Actual:
  - Severity:
  - Evidence:

## Warnings
- None / list each issue with:
  - Area:
  - Risk:
  - Follow-up:

## Skipped / Not Applicable
- Check:
- Reason:

## Recommendation
- [ ] Ready to ship
- [ ] Ready with warnings
- [ ] Do not ship
```

## Notes

- Prefer the smallest relevant targeted tests first when only one subsystem changed.
- Use packaged-app checks for ship candidates and native/runtime-sensitive changes.
- If a check is skipped, document why.
- If a blocker is found, stop and fix it before continuing.
