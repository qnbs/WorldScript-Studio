# Test mock patterns

**useAppSelectorShallow with plotBoard:** Include `plotBoard: { activeMode: 'swimlane', snapToGrid: false, selectedConnectionId: null, isDrawingConnection: false, drawFromSectionId: null, activeSubplotFilter: null, zoom: 1, panX: 0, panY: 0 }` in mock state. Connections/subplots/tensionOverrides are in `project.present.data`. **Existing convention** (10 test files, e.g. `tests/unit/SceneBoardView.test.tsx`): the `useAppSelector`/`useAppSelectorShallow` mock is typed `(selector: (s: any) => unknown)` with `// biome-ignore lint/suspicious/noExplicitAny: test mock` above it, since the partial mock state doesn't satisfy the full `RootState` type. This documents that pre-existing pattern for consistency — do not add a *new* suppression elsewhere; a shared, properly-typed helper (`(selector: (s: RootState) => unknown) => selector(mockState as RootState)`, no `any` needed) that replaces all 10 call sites is a good candidate for a future dedicated refactor, not a one-off addition here.

**FeatureFlagsState mocks:** Always include ALL 23 flags (TypeScript strict rejects partial). Only **seven** default **off**: `enableProForge`, `enableRtlLayout`, `enableVoiceSupport`, `enableVoiceWasm`, `enableGlobalCopilot`, `enableLocalFirstSync`, `enableBrowserOllama` — every other flag (including all edge-AI flags and `enableIdbAtRestEncryption`) defaults **on**. When a test needs a non-default flag state, set it explicitly in the mock — don't assume the default.

**ConnectionLayer test IDs:** `data-testid="connection-group"` — query by testid, not role.

**DuckDB in tests:** Mock `services/duckdb/duckdbClient` with `{ execAsync: vi.fn(), queryAsync: vi.fn() }`. Never initialize real DuckDB-WASM.

**AI thunk tests:** `settingsReducer` defaults to `privacy.localStorageOnly: true` → AI thunks throw. Fix: mock `services/ai/aiPolicy` with `assertCloudAiAllowedSync: vi.fn()` + `assertCloudAiAllowed: vi.fn().mockResolvedValue(undefined)` before all imports.

**Context hooks in component tests:** Mock the context module (`vi.mock('../../../contexts/XyzContext', ...)`) rather than wrapping in the real provider tree. Apply for any `use*ViewContext` hook.

**Custom Select/LanguageSelector mocks:** Mock as native `<select>` element for testing-library compatibility. See canonical pattern in existing settings test files.

**E2E notes:** Do NOT use `networkidle` waits (HMR keeps WebSocket open). Scope sidebar navigation via `#sidebar`. Shared helpers: `tests/e2e/helpers.ts`. Mobile E2E: set `RUN_MOBILE_E2E=1` locally (off by default).

**Feature-flag E2E coverage (anti-pattern guard):** Every test that relies on a specific flag state MUST use `setFeatureFlags(page, {...})` from `helpers.ts` to make that dependency explicit and guard against future default changes. Call it BEFORE `page.goto()` — it uses `addInitScript` so it runs before app JS.

Three E2E layers: (1) feature specs (`proforge-flags.spec.ts`, `voice-flags.spec.ts`, `lora-wizard.spec.ts`) — flag explicitly seeded, required CI gate; (2) deep matrix (`tests/e2e/deep/feature-flag-matrix.spec.ts`) — parametrized smoke across all `testConfigurations` in `test-matrix.ts`, non-blocking `e2e-deep` job; (3) error paths (`tests/e2e/deep/error-paths.spec.ts`) — offline AI, rapid nav, all flags on; also in `e2e-deep`.

When adding a new feature flag: (a) add an entry to `tests/e2e/config/test-matrix.ts`, (b) write at least one test in `tests/e2e/<feature>-flags.spec.ts` that seeds the flag and verifies a critical UI element. Ask: *"If this flag were off by default tomorrow, would CI still catch a regression?"*
