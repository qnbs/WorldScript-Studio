# Test mock patterns

**useAppSelectorShallow with plotBoard:** Include `plotBoard: { activeMode: 'swimlane', snapToGrid: false, selectedConnectionId: null, isDrawingConnection: false, drawFromSectionId: null, activeSubplotFilter: null, zoom: 1, panX: 0, panY: 0 }` in mock state. Connections/subplots/tensionOverrides are in `project.present.data`. **Existing convention** (10 test files, e.g. `tests/unit/SceneBoardView.test.tsx`): the `useAppSelector`/`useAppSelectorShallow` mock is typed `(selector: (s: any) => unknown)` with `// biome-ignore lint/suspicious/noExplicitAny: test mock` above it, since the partial mock state doesn't satisfy the full `RootState` type. This documents that pre-existing pattern for consistency — do not add a *new* suppression elsewhere; a shared, properly-typed helper (`(selector: (s: RootState) => unknown) => selector(mockState as RootState)`, no `any` needed) that replaces all 10 call sites is a good candidate for a future dedicated refactor, not a one-off addition here.

**FeatureFlagsState mocks:** Always include ALL 23 flags (TypeScript strict rejects partial). Only **seven** default **off**: `enableProForge`, `enableRtlLayout`, `enableVoiceSupport`, `enableVoiceWasm`, `enableGlobalCopilot`, `enableLocalFirstSync`, `enableBrowserOllama` — every other flag (including all edge-AI flags and `enableIdbAtRestEncryption`) defaults **on**. When a test needs a non-default flag state, set it explicitly in the mock — don't assume the default.

**ConnectionLayer test IDs:** `data-testid="connection-group"` — query by testid, not role.

**DuckDB in tests:** Mock `services/duckdb/duckdbClient` with `{ execAsync: vi.fn(), queryAsync: vi.fn() }`. Never initialize real DuckDB-WASM.

**AI thunk tests:** `settingsReducer` defaults to `privacy.localStorageOnly: true` → AI thunks throw. Fix: mock `services/ai/aiPolicy` with `assertCloudAiAllowedSync: vi.fn()` + `assertCloudAiAllowed: vi.fn().mockResolvedValue(undefined)` before all imports.

**Context hooks in component tests:** Mock the context module (`vi.mock('../../../contexts/XyzContext', ...)`) rather than wrapping in the real provider tree. Apply for any `use*ViewContext` hook.

**Custom Select/LanguageSelector mocks:** Mock as native `<select>` element for testing-library compatibility. See canonical pattern in existing settings test files.
