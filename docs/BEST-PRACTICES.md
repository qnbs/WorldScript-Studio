# StoryCraft Studio — Engineering & Content Best Practices

Single reference for maintainers: architecture touchpoints, content rules, security/privacy framing, testing expectations, and CI gates. Product docs and tutorials remain in the [Documentation Hub](../README.md#documentation-hub).

## Architecture (short)

- **State:** Redux Toolkit feature slices + listener middleware for side effects; transient UI in Zustand (`app/transientUiStore.ts`). v1.6 adds `plotBoard` (viewport/draw UI only — localStorage, NOT undo-able; connections/subplots/tension moved to `projectSlice` for undo support), `progressTracker` (session/streak/goals), and `sceneComments` (IDB-persisted via listenerMiddleware).
- **Persistence:** `storageService` → `StorageBackend` (`IndexedDB` web / filesystem Tauri). No second ad-hoc storage for secrets. v1.6 adds `scene-revisions` IDB store (`services/sceneRevisionService.ts`).
- **AI:** `geminiService` / `aiProviderService` — all network AI goes through these adapters. 4-layer local inference stack: WebLLM → ONNX → Transformers.js → BoW fallback.
- **Commands:** `services/commands/` registry; execution via `CommandExecutorProvider` / `runCommandById`.
- **i18n:** Source modules under `locales/<lang>/*.json`; runtime bundles `public/locales/<lang>/bundle.json` rebuilt by `pnpm run i18n:bundle` / `i18n:check`. 2340 keys × 11 locales.

## Content & copy

- **Tone:** Supportive, precise; AI as co-pilot, not ghostwriter. Match formality to each locale (de/fr/es/it/en).
- **Glossary (UI):** Use consistently across Settings, Help, and Command Palette:
  - **Manuscript** — main text / chapter view
  - **Outline** — plot structure / plot skeleton (not mixed with “template structure” in user-facing text without context)
  - **Template** — predefined narrative structure
  - **Codex / Story Bible** — project-internal reference (as named in the app)
  - **Snapshot** — zeitpunktbezogene Sicherung des Projekts (project-level; distinct from **Scene Revision** which is per-scene)
  - **Scene Revision** — per-scene snapshot (IDB, max 50 per scene, auto-saved on content change)
  - **Writing Session** — timed session tracked in Progress Tracker (start/stop via Ctrl+Shift+S)
  - **Subplot** — named story thread with color and scene assignments (Plot Board feature)
  - **Connection** — SVG directional link between scenes on the Plot Board canvas
- **Errors:** Pattern: what happened → what to do next → optional command/deep link; technical IDs only in `logger`.
- **Help articles:** Prefer `tryActionId` mapping to a `nav-*` command so “Try it now” jumps to the right view.
- **Community templates:** Canonical English JSON in `community-templates/index.json` and mirrored copy under `public/community-templates/`; validated by `pnpm run content:guard` and Zod in `fetchCommunityTemplates`.

## Security & privacy (product-facing)

- Never log API keys or decrypted payloads.
- **Marketing accuracy:** Offline-first means project storage is local; cloud AI is optional and user-triggered. Align README/Help FAQ with this split.
- **Web vs Tauri:** CSP and hardening differ by host; follow `src-tauri` configuration for desktop builds.

## Internationalization

- Add keys to **all** of `de`, `en`, `fr`, `es`, `it`, then `pnpm run i18n:check`.
- Key parity is enforced in CI; meaning review for FR/ES/IT is manual/editorial.

## Accessibility

- Maintainer reference: **[`docs/ACCESSIBILITY.md`](ACCESSIBILITY.md)** (live regions, focus traps, Lighthouse / axe / Storybook addon-a11y).
- Product UX copy for accessibility belongs in locale modules like any other UI string.

## Testing & coverage

- **Unit/integration:** Vitest; global coverage thresholds in `vitest.config.ts` are a regression floor. Current (v1.6): lines 63 / branches 48 / functions 54 / statements 62. Target for v2.0: branches ≥ 55%.
- **Risk-hotspots** (aim for focused tests when touching): `dbService`, `dbMigration`, `aiProviderService`, `sceneRevisionService`, `plotBoardService`, `deepLinkService`, project import/export, `storageService` / `storageBackend`.
- **v1.6 test isolation pattern:** `sceneRevisionService` tests require `@vitest-environment node` + per-test `IDBFactory` + `_resetDbForTest()`. See `CLAUDE.md § v1.6 Patterns`.
- **Custom Select testing:** Components using `Select` or `LanguageSelector` should mock them as native `<select>` elements in tests for compatibility with testing-library queries. See `docs/UI-MODERNIZATION.md` Testing section for the mock pattern.
- **E2E:** Playwright (CI-only `CI=true`); a11y smoke with axe (see `tests/e2e/a11y.spec.ts`). Plot-board E2E: `tests/e2e/plot-board.spec.ts`.
- **Mutation:** Stryker job (`mutation.yml`) is informational until `break` threshold is raised. Current targets: 9 service files in `stryker.conf.json`.

## CI gates — cloud-first workflow

**Local (fast, low-RAM):**
```bash
pnpm run lint && pnpm run i18n:check && pnpm run typecheck
# Optional: single test file during development
pnpm exec vitest run tests/unit/myFile.test.ts
```

**CI (authoritative):** Every push triggers `security → quality → build → e2e → lighthouse → deploy`. Metrics (coverage %, test count) come from CI artifacts; update `README.md` badges and `AUDIT.md` quality-gate lines from CI output after each release.

After CI goes green:
1. Read coverage % from the `quality` job logs or Codecov badge.
2. Update `README.md` `Tests-NNN_%2F_NNN_files` and `Coverage-XX.XX%25` badges.
3. Update `AUDIT.md` quality-gate line for the new version.
4. Commit: `chore(docs): update metrics from CI vX.Y.Z`.

## RTL & future locales

- No RTL locale shipped yet. When adding one: set `dir` on the document root from language metadata, mirror spacing in new CSS using logical properties where possible, and audit modals/scroll locks.

## Plugin-style extensibility (lightweight)

- Prefer stable seams over a full plugin runtime: `featureFlags`, commands registry, `storageService`, and documented JSON contracts (settings exchange, project export).
