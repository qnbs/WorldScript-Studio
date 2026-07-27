# Test mock patterns

**useAppSelectorShallow with plotBoard:** Include `plotBoard: { activeMode: 'swimlane', snapToGrid: false, selectedConnectionId: null, isDrawingConnection: false, drawFromSectionId: null, activeSubplotFilter: null, zoom: 1, panX: 0, panY: 0 }` in mock state. Connections/subplots/tensionOverrides are in `project.present.data`. Add `// biome-ignore lint/suspicious/noExplicitAny: test mock` before `(selector: (s: any) => unknown)` lines.

**FeatureFlagsState mocks:** Always include ALL 22 flags (TypeScript strict rejects partial). Only **six** default **off**: `enableProForge`, `enableRtlLayout`, `enableVoiceSupport`, `enableVoiceWasm`, `enableGlobalCopilot`, `enableLocalFirstSync` — every other flag (including all edge-AI flags and `enableIdbAtRestEncryption`) defaults **on**. When a test needs a non-default flag state, set it explicitly in the mock — don't assume the default.

**ConnectionLayer test IDs:** `data-testid="connection-group"` — query by testid, not role.

**DuckDB in tests:** Mock `services/duckdb/duckdbClient` with `{ execAsync: vi.fn(), queryAsync: vi.fn() }`. Never initialize real DuckDB-WASM.

**AI thunk tests:** `settingsReducer` defaults to `privacy.localStorageOnly: true` → AI thunks throw. Fix: mock `services/ai/aiPolicy` with `assertCloudAiAllowedSync: vi.fn()` + `assertCloudAiAllowed: vi.fn().mockResolvedValue(undefined)` before all imports.

**Context hooks in component tests:** Mock the context module (`vi.mock('../../../contexts/XyzContext', ...)`) rather than wrapping in the real provider tree. Apply for any `use*ViewContext` hook.

**Custom Select/LanguageSelector mocks:** Mock as native `<select>` element for testing-library compatibility. See canonical pattern in existing settings test files.
