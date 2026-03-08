# AGENTS.md

Agent guidance for `/Users/jude/xp/vorn/voice`.
Keep edits minimal, typed, and aligned with existing patterns.

## Project Snapshot

- App: Electron + TypeScript + React (`vorn-voice`).
- Main process code: `src/main/`.
- Preload bridge: `src/preload/preload.ts`.
- Renderer UI: `src/renderer/` (Vite).
- Shared contracts/types: `src/shared/`.
- Tests: `Tests/**/*.test.ts` via Vitest in Node environment.
- Secondary app: `website/` (Next.js 16, separate scripts and lint config).

## Repository Layout

- `src/main/main.ts`: startup/bootstrap orchestration.
- `src/main/coordinator.ts`: dictation lifecycle and state transitions.
- `src/main/ipc/handlers.ts`: IPC registrations and IPC-safe payload flow.
- `src/main/services/`: hotkey, audio, whisper, model, permissions, updates, settings.
- `src/main/windows/`: settings/overlay BrowserWindow wrappers.
- `src/preload/preload.ts`: typed `voicebar` API exposed with `contextBridge`.
- `src/renderer/settings/SettingsApp.tsx`: major settings UI and onboarding flow.
- `src/shared/types.ts`: canonical cross-process interfaces and constants.

## Build, Lint, and Test Commands

### Root app (`/voice`)

- Install deps: `npm install`
- Dev app: `npm run dev`
- Typecheck (main + renderer): `npm run typecheck`
- Full test suite: `npm test`
- Single test file (preferred): `npm test -- Tests/main.test.ts`
- Another file example: `npm test -- Tests/coordinator.test.ts`
- Single test name: `npm test -- -t "opens settings when startup reports"`
- Direct vitest single file: `npx vitest run Tests/main.test.ts --config vitest.config.ts`
- Direct vitest single test name: `npx vitest run --config vitest.config.ts -t "startup error dialog"`

### Build/packaging commands (use only when explicitly requested)

- App build: `npm run build`
- Run packaged app locally: `npm run start`
- Packaging: `npm run package:mac:local` / `npm run package:mac:release`
- Verify packaged app: `npm run verify:mac:local` / `npm run verify:mac:release`

### Website app (`/voice/website`)

- Dev: `npm --prefix website run dev`
- Build: `npm --prefix website run build`
- Start: `npm --prefix website run start`
- Lint: `npm --prefix website run lint`
- Note: no website test script is currently configured.

## Test Notes

- Vitest config: `vitest.config.ts`.
- Included files: `Tests/**/*.test.ts`.
- Environment: `node` (not `jsdom`).
- Common test style: `vi.doMock(...)` + dynamic `await import(...)` for startup isolation.
- Always run the smallest relevant tests first, then broaden if needed.

## Linting Notes

- Root app has no `lint` script and no root ESLint/Prettier/Biome config.
- Root quality baseline is `npm run typecheck` + targeted tests.
- Website has ESLint config at `website/eslint.config.mjs` using Next core-web-vitals + TypeScript presets.

## Cursor/Copilot Rule Files

- `.cursorrules`: not found.
- `.cursor/rules/`: not found.
- `.github/copilot-instructions.md`: not found.
- If added later, merge those constraints into this file immediately.

## Code Style Guidelines

### Formatting and syntax

- Use TypeScript for all application code.
- Keep strict compiler guarantees; do not relax `strict` settings.
- Use 2-space indentation, semicolons, and double quotes.
- Favor small focused functions and early returns.
- Avoid broad refactors unless they are required for the task.

### Imports

- Prefer builtins/external imports before internal relative imports for new files.
- Preserve existing order/grouping in touched files unless reordering is required.
- Use `import type` for type-only imports when practical.
- Keep import edits minimal; avoid churn from cosmetic reorder-only changes.

### Types and contracts

- Reuse shared types from `src/shared/types.ts`; do not duplicate payload shapes.
- At boundaries (IPC, preload, service APIs), use explicit parameter and return types.
- Prefer union types and literal objects (`as const`) over enums unless existing code uses enums.
- Avoid `any`; if unavoidable, isolate it at external boundaries and narrow quickly.
- Keep IPC payloads serializable.

### Naming conventions

- PascalCase: classes, React components, type aliases/interfaces.
- camelCase: variables, functions, methods, object fields.
- UPPER_SNAKE_CASE: exported constants.
- Use descriptive names (`permissionState`, `recordingStartedAt`) over abbreviations.

### Error handling

- Catch `unknown` and convert to user-safe messages (for example via helper functions).
- Use `try/catch/finally` around async workflows that update UI or lifecycle state.
- `catch {}` is acceptable only for intentional best-effort cleanup.
- Do not silently swallow meaningful failures.
- Prefer graceful fallback behavior for recoverable issues.

### Async and side effects

- Mark intentionally unawaited promises with `void`.
- In JSX handlers, use `onClick={() => void someAsyncAction()}`.
- In React effects with async logic, use cancellation guards and cleanup.
- Keep preload methods thin wrappers around `ipcRenderer.invoke` and typed event subscriptions.

### Main process conventions

- Compose services explicitly during bootstrap; keep dependency flow readable.
- Keep mutable module-level state minimal and typed.
- Guard BrowserWindow/WebContents access when windows may be destroyed.
- Prefer state transitions with explicit status/mode updates.

### Renderer conventions

- Use function components with typed props.
- Keep component-local helper types near their usage (`type XProps = ...`).
- Use `useMemo` for derived lists/lookups when repeated each render.
- Keep status/toast and async operation state explicit (`saving`, `installingRuntime`, etc.).
- Reuse existing UI primitives/patterns instead of introducing a new visual system.

### Testing conventions

- Import Vitest globals explicitly from `vitest`.
- Use behavior-oriented test names and assertions.
- Reset module/mocks in `beforeEach` when startup state is involved.
- Prefer focused mocks per test over global heavyweight fixtures.

## Agent Working Rules

- Default verification flow for code changes:
  1. `npm run typecheck`
  2. targeted `npm test -- Tests/<file>.test.ts`
  3. broader `npm test` only when needed
- Do not run packaging/release commands unless explicitly requested.
- Do not add dependencies unless required by the task.
- Do not remove or revert unrelated user changes.
- Keep comments minimal and only for non-obvious logic.
