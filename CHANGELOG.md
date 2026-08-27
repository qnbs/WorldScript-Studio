# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

<!-- release-candidate: v1.28.2 -->

## [1.28.2] — 2026-08-27

### Fixed

- **Service-worker cache deletion is now positively ownership-scoped:** every cache-deletion site
  (non-Tauri activation cleanup, the Tauri unregister path, the user-initiated "clear cache" action,
  and Factory Reset) now matches against an exact, closed set of this app's own cache-name families
  before deleting anything, closing a shared-origin data-deletion risk where an unrelated cache could
  be swept up by a blanket prefix or unconditional `caches.keys()` sweep.
- **Desktop filesystem corruption/I-O failures now fail closed, not silently absent:** a corrupted
  or unreadable saved project file used to decompress/parse into a fake empty object and be treated
  as "no saved project" — risking a subsequent autosave silently overwriting the only remaining
  copy. Corruption and I/O failure are now distinct, typed, thrown errors the caller must handle
  explicitly; genuine absence is unaffected.
- **PWA service-worker updates flush pending state before reloading:** the visible tab now
  retry-flushes in-flight persistence (with a bounded final attempt and timeout) before a
  forced update reload, instead of reloading unconditionally on the assumption that autosave alone
  made it safe. This is a bounded mitigation, not a closed invariant — full cross-tab write
  coordination remains tracked separately (#480/#485); the residual risk after this fix is
  documented in #518.
- **DOCX export now produces a real DOCX file everywhere it's offered:** selecting DOCX in the
  in-app export dialog, the Writer export view, and the desktop file-save export path all
  previously silently wrote a Markdown-shaped file with a `.docx` extension. All three now build a
  genuine `docx`-package document and write real binary output.
- **GitHub Pages deploy no longer silently skips on main pushes:** the deploy job's default
  admission gate inherited GitHub Actions' skip-propagation from unrelated, legitimately-skipped
  upstream jobs (PR-only governance checks, path-scoped Rust gates) even when the real required
  aggregator had genuinely succeeded — the live GitHub Pages mirror had been intermittently stale
  since 2026-08-20 and consistently stale since 2026-08-26. Now gated explicitly on the
  aggregator's own result.

### Documentation

- **Onboarding install command corrected:** README/CONTRIBUTING pointed contributors at a bare
  `pnpm install`, which skips `--frozen-lockfile` and this repo's own dependency-fingerprint check.
  All onboarding paths now point at the frozen-lockfile reconcile command.
- **Desktop installer signing language narrowed to match reality:** README claimed desktop
  installers were generically "signed"; only the auto-update manifest's per-platform Minisign
  signatures are produced by default — OS-level code signing (Authenticode, notarization) is not
  currently configured in CI.

### Added

- **Structural workflow-policy YAML authority:** a real-parser (not regex) validator for every
  `.github/workflows/*.yml` and `.github/actions/**/action.yml` — top-level permissions, the
  `needs:` graph, SHA-pinned action references, and the publishing boundary. Runs first in CI,
  before any job invokes the governed `setup` composite action.
- **Tiered PR-size governance:** advisory `target`/`hard`/`docsGovernance` limits and a blocking
  `absolute` ceiling on changed files, meaningful lines, and commits, with a dedicated profile for
  all-documentation PRs. Excludes generated locale bundles, the `pnpm-lock.yaml` churn, and
  content-guard's own mirrored `community-templates/index.json` from the size calculation so an
  atomic i18n or lockfile change can't be falsely flagged; runs the base ref's own copy of the
  checker so a PR touching it can't raise its own limits.
- **Intel macOS qualification-only build lane:** a `workflow_dispatch`-only, non-publishing
  verification lane for the `macos-15-intel` runner class (GitHub's current replacement for the
  retired `macos-13` label), with no signing secrets and no release artifacts.

### Changed

- **Pre-push evidence and local-admission tooling reconstructed** as smaller, independently
  reviewed slices: canonical path-evidence completeness, change-aware local checks, bounded
  subprocess lifecycle for the pre-commit/pre-push runners, working-tree-vs-push divergence
  detection, and exact-localSha dependency-manifest compatibility proof.
- **Qt/PWA native desktop architecture-governance roadmap reconciled:** Wave 2.5 amendment, gates
  G1.5/G2.5, and reuse-ownership authority folded into the canonical roadmap and ledger docs.

### Security

- `google/osv-scanner-action` `2.5.0` → `2.5.1`.
- `docker/setup-buildx-action` `4.2.0` → `4.3.0`.

### Quality and governance

- The frozen reconstruction-source PR was fully reconciled: every still-required piece was rebuilt
  fresh against current `main` and merged through small, independently reviewed PRs; every other
  piece was already shipped through a separate implementation or is a deliberately deferred
  architecture question with durable issue tracking.

## [1.28.1] — 2026-08-23

### Added

- **Scenario/Screenplay canonical projection workspace:** the new workspace exposes a
  renderer-neutral projection for scenario and screenplay work while keeping the existing
  TypeScript authority intact.
- **Core project validation shadow caller:** desktop loads now observe the bounded Rust project
  validation verdict through `DesktopPlatform`; this is observation-only and does not switch
  authority from the existing TypeScript path.

### Fixed

- **Writing-overlay immediacy:** overlay feedback is now visible without waiting for a later
  render cycle.
- **Serialized persistence protection:** overlapping persistence writes are coordinated so a
  later save cannot race an earlier save and corrupt the durable project state.

### Security

- **Verified release source history:** signing doctor, local commit/push enforcement, exact-range
  verification, annotated-tag enforcement, and GitHub Verified checks now form the release-source
  trust boundary.
- **Supply-chain monitoring:** the daily OSV workflow and hardened pnpm bootstrap/version pinning
  extend the existing dependency and CI security controls.

### Quality and governance

- **Policy and mutation coverage:** CI authority, selector/AI-core mutation oracles, and the
  packaged editor readability oracle were strengthened for this release line.
- **Native lifecycle truth:** the #332 lifecycle evidence and Qt early-killer gates are documented
  without claiming packaged closure.

### Release boundaries

- Packaged Linux lifecycle/Alt+Tab validation for **#332 remains pending**; reporters should
  validate the new `.deb` using the documented lifecycle, Alt+Tab, and persistence protocol.
- Packaged dark/sepia/PWA-versus-packaged readability validation for **#341 remains pending**;
  publication or CI does not close that issue.
- PWA remains first-class, Tauri remains transitional, and Qt remains the future native target
  behind its evidence gates.
- No unsupported macOS Intel artifact is claimed; only artifacts actually produced by the release
  workflow belong in updater metadata.

## [1.28.0] — 2026-08-21

### Added

- **Cloud model catalog defense-in-depth:** current Anthropic, OpenAI, and xAI model IDs now
  share one typed catalog across settings, fallbacks, and the Claude proxy allowlist.
- **Native bundle and translation-quality floors:** bundle budgets now distinguish entry, vendor,
  regular JS, and WASM assets; CI also enforces the existing translation coverage/outlier floor.
- **Renderer-neutral Rust Core seed:** `crates/worldscript-project` now provides headless project
  schema, validation, migration, plain JSON I/O, and a test/CLI harness, with one narrow Tauri
  validation command wired through the cross-workspace path dependency.
- **Rust TaskSupervisor bounded text proof:** adds bounded renderer-neutral `text.analyze` and
  `text.diff` tasks, typed qualification wrappers, deterministic LCS/whitespace contracts, and
  explicit fallback to the existing TypeScript path; no production caller is switched yet.

### Fixed

- **Release-truth guard:** `docs:check` now verifies the release-tag frontier, package/tag
  relationship, README release badges, and non-empty `[Unreleased]` history without treating
  tagless or shallow checkouts as a false failure.
- **Spotlight tour theme:** the post-rebrand driver.js popover now binds to its WorldScript CSS
  selector, with a regression test protecting the binding.
- **Desktop encryption scope truth:** desktop project files remain explicitly documented as
  plaintext until the renderer-neutral R-15 storage work ships; the IndexedDB passphrase flow no
  longer presents itself as a project-file encryption gate on Tauri.
- **CI authority closure:** Core path changes now select the Tauri consumer gate, workflow-policy tests protect local path-dependency coverage and aggregate deployment gating, and Pages deployment waits for `ci-success`.
- **Accessibility contrast:** command-palette heading contrast was corrected to meet the intended
  WCAG threshold.

### Deprecated

- **`storycraft://` deep links:** the legacy scheme remains accepted for this release and displays
  a migration notice; it is scheduled for removal in the next release.

### Changed

- **CSP egress parity:** Web/PWA and Tauri now use one explicit provider, local-service, and Yjs
  signaling origin allowlist; arbitrary HTTPS egress and the contradictory loopback upgrade policy
  are no longer accepted. New BYOK endpoints require an explicit CSP policy update.
- **Qt Early Killer-Gate qualification:** the native roadmap now requires cheap, evidence-backed
  lifecycle, accessibility/input, packaging/update-trust, crash/recovery, and security checks
  before substantial Qt UI work can create sunk cost.

- **Diagnostics sink boundary:** structured log construction and recursive redaction now remain
  portable before serialized IDB, Tauri JSONL, and development-console adapters receive the record;
  legacy logger APIs remain compatible and no sink authority switch is claimed.
- **Coverage scope and threshold calibration:** coverage now measures the root application/PWA
  shell; CI recalibrated floors to L80/F72/B66/S78 from the expanded-scope measurement, and the
  token audit baseline was ratcheted down from 160 to the verified current count of 159.
- **Native desktop strategy:** ADR-0021 adopts Qt 6/Qt Quick as the future primary native product,
  keeps React/PWA first-class, makes Tauri transitional, admits GPUI later behind a gate, and
  retires CEF from the target architecture.
- **DesktopPlatform boundary:** direct Tauri imports are mechanically constrained by the zero-
  tolerance guardrail while the renderer-neutral contract becomes the native transition surface.
- **Diagnostics parity and task contracts:** Rust/TypeScript wire-shape and redaction fixtures now
  cover the diagnostics boundary, and TaskSupervisor requests/results reject unsupported contract
  versions before native execution (#437, #439, #440).
- **Native maturity evidence:** the G1 qualification ledger now records the partial, evidence-backed
  status of the native migration without claiming a production authority switch (#438).
- **Mutation-test plumbing:** the manual Stryker workflow now uses explicit per-module incremental
  files, preserves module report identity, validates aggregate metrics, fails closed on missing
  shards, and propagates aggregation failures through the summary pipeline.
- **Quality-gate truth:** Vitest CI no longer retries the suite, the suppression ratchet was
  reduced from 52 to 48 through real test-mock cleanup, and docs checks now validate README test
  file/case metrics against the current Vitest source set.

### Security

- **CI supply-chain policy:** CodeQL action references and token permissions were hardened and
  Dependabot grouping was corrected so related action paths move together.
- **Diagnostics redaction:** sensitive nested diagnostic context is recursively redacted before
  serialized IDB, Tauri JSONL, or development-console sinks receive it.

## [1.27.1] — 2026-08-14

> Desktop persistence/security stabilization (#363) — atomic writes and fail-closed key routing
> across every Tauri filesystem-backed store, a factory-reset UI/logic consolidation, and three
> new required CI gates (Rust compile/lint/test, E2E, Visual Regression) that previously let
> native-code and UI-regression risk merge unchecked — plus a nanoid security-advisory patch.

### Fixed

- **Atomic writes across all Tauri filesystem-backed stores** (`services/fs/{assetFsStore,
  codexFsStore,fsCore,projectFsStore,settingsFsStore,snapshotFsStore}.ts`) — writes are now
  serialized, and an orphaned temp file left behind by a failed write is retried on cleanup (with a
  warning logged, not silently dropped) instead of risking corruption of concurrently-written
  project data.
- **Unified, fail-closed desktop API-key routing.** Desktop key storage now routes unconditionally
  through the same encrypted IndexedDB path used on the web, with recovery-reset hardened to fail
  closed rather than leaving a partially-wiped state; `docs/SECURITY-THREAT-MODEL.md` corrected to
  describe the unconditional routing and the best-effort (not guaranteed) nature of legacy-key-file
  cleanup.
- **Factory reset / danger-zone UI consolidated.** New `hooks/useFactoryReset.ts` +
  `components/settings/FactoryResetDangerZone.tsx` replace three near-duplicate confirm/wipe/error/
  busy implementations across `ApiKeySection`, `IdbUnlockModal`, and `EncryptionRecoveryModal`; also
  fixes a bug where the stuck "recovery-required" branch had no error paragraph to render a failed
  reset's error state.
- **Packaged-build factory reset was broken.** The Tauri fs capability glob for `fs:allow-exists`
  and `fs:allow-read-dir` only covered `$APPDATA/**`, rejecting `exists()`/`readDir()` on the
  `$APPDATA` root itself; the capability now grants the exact root path too
  (`src-tauri/capabilities/default.json`).
- **Corrupt binder-asset detection fixed.** A binary/metadata byte-size mismatch is now treated as
  corruption instead of silently pairing two independent atomic writes from different save
  generations as if they were one transaction.
- **Legacy API-key file cleanup no longer provider-list-bound.** Scans the config directory by the
  `*_key.enc.json` naming convention instead of a hardcoded 5-provider list, so a future or
  unlisted provider's legacy key file is no longer left behind after migration.
- **Rust: `Builder::on_menu_event` gated `#[cfg(desktop)]`.** The call was unconditional despite
  the crate itself restricting that method to desktop, which would have failed to compile for the
  mobile targets `src-tauri/src/lib.rs` already anticipates (`#[cfg_attr(mobile, ...)]`).
- **Re-wired the dead Rust menu-action event bridge.** `registerTauriMenuHandler` is back as a
  pre-paint-window fallback, self-unregistering once the JS-owned menu (`installDesktopMenu`) takes
  over — the native fallback menu's items were previously silently inert, and the two menus can no
  longer double-dispatch a single click.

### Security

- **nanoid security advisory patched** (PR #362) — `nanoid@3.3.17` → `3.3.18`, added to
  `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` so the fix isn't held back by the
  10,080-minute (7-day) `minimumReleaseAge` policy.

### Changed

- **CI: Rust compile/lint/test, E2E, and Visual Regression Testing are now required merge gates**
  (`rust-tauri`, `e2e`, `vrt` join the `ci-success` aggregator's `needs`). Previously native Rust
  code and UI regressions could merge into `main` with no automated check beyond an advisory OSV
  vulnerability scan.

### Tests

- Added coverage for the new `clearTauriAppData` branch and the factory-reset danger-zone UI
  (`tests/unit/factoryResetService.test.ts`, `tests/unit/settings/{EncryptionRecoveryModal,
  IdbUnlockModal}.test.tsx`, `tests/unit/services/fs/{fsCore,fsStores}.test.ts`,
  `tests/unit/tauriServices.test.ts`, `tests/unit/ApiKeySection.test.tsx`) — `codecov/patch` had
  dropped to 52.75% before this pass.

## [1.27.0] — 2026-08-13

### Added

- **Durable encryption migration journal** (`services/storage/encryptionMigrationJournal.ts`) —
  persisted, versioned, no-secret coordination metadata (phase, per-store checkpoints, a
  compare-and-swap owner lease) for cross-database at-rest encryption migrations, which cannot be
  wrapped in a single atomic IndexedDB transaction. Protected access is blocked while a migration
  is active or requires recovery, and a durable transaction prevents competing migration owners.
  This is a recovery foundation — see below for what still isn't wired to a production trigger.
  (#337)
- **Resumable protected-store migration runner** (`protectedStoreMigration.ts`) with registered
  adapters for the two secondary stores (scene revisions, AI inference cache): batch conversion,
  interruption/resume from the last durable checkpoint, and verification that distinguishes a
  genuine shortfall from records legitimately deleted by cache eviction or history retention.
  (#337)
- **Cross-tab admission for protected writes vs. active migrations**
  (`services/storage/protectedWriteAdmission.ts`) — a Web Locks API shared/exclusive lock closes
  the race where an ordinary protected write could commit after a migration had already claimed
  ownership of the same store, which could otherwise land ciphertext under a superseded
  key/generation. (#339)
- **Manual "Reduce transparency effects" accessibility toggle** (Settings › Accessibility,
  `accessibility.reducedTransparency`, default off) — strips `backdrop-blur-*` GPU compositing
  everywhere, for desktop/Linux users whose window manager doesn't expose the OS-level
  `prefers-reduced-transparency` preference that the existing automatic mitigation relies on.
  (#332)
- **Downloaded/total size and speed in both model-download progress UIs** (#333 item 1).
  `VoiceModelDownloadModal` now shows real byte counts and transfer speed, sourced directly from
  transformers.js's own progress payload (`loaded`/`total` fields it was already receiving but
  discarding). `LocalAiDownloadProgress` (WebLLM text models) shows an **approximate** downloaded/
  total MB and speed, derived from the existing 0-1 progress fraction × a new per-model known-size
  table (`WEBLLM_MODEL_APPROX_MB`) — the installed `@mlc-ai/web-llm`'s own progress callback exposes
  no structured byte counts, so this is clearly labeled as an estimate, not measured telemetry.
- **Disabling at-rest encryption and rotating the storage passphrase are now live** in Settings ›
  Privacy — the production wiring the prior release's migration journal was built for. Both flows
  run through the same resumable, crash-recoverable migration journal, verify identity via a
  durable AES-GCM sentinel/verifier before touching any data, and surface an `EncryptionRecoveryModal`
  on next startup if a migration was interrupted mid-flight. Closes
  [issue #338](https://github.com/qnbs/WorldScript-Studio/issues/338). (#342, #343)

### Changed

- **IndexedDB at-rest encryption now fails closed instead of silently downgrading to plaintext.**
  Protected reads and writes are rejected with a typed locked-storage error whenever encryption is
  configured but the session key is missing, closing several Time-Of-Check-To-Time-Of-Use gaps
  where an intervening `await` (opening a transaction, awaiting encryption) could let Lock Session
  race a write into plaintext. Every previously-unguarded destructive/listing path (`deleteImage`,
  `deleteBinderAsset`, `listBinderAssetIds`, `deleteStoryCodex`, `listSnapshots`, `deleteSnapshot`,
  `deleteProject`) now has the same guard. At the time of this change, disabling encryption or
  rotating the passphrase was intentionally unavailable pending the migration journal's resumable
  conversion protocol being wired to a production trigger — see the "Added" section above for the
  production wiring that shipped in this same release. (#335)
- **Desktop AI provider and Python integration hardening**, addressing user-reported release-quality
  issues #332/#333: removed the brittle Gemini `AIza`-prefix key rejection in favor of minimal
  syntax checks plus real provider validation; Local AI cancel/retry now operates on the actual
  in-flight acquisition instead of a detached handle, and terminal failures stay visible instead of
  silently resetting to idle; LM Studio discovery/testing now uses the correct OpenAI-compatible
  `/v1/models` endpoint with sanitized diagnostics surfaced in the UI; desktop Python discovery,
  executable selection, and version/error reporting were centralized for consistency across
  commands. (#336)

### Fixed

- **Secure-record codec no longer silently corrupts unsupported structured-clone types.** `Map`,
  `Set`, `RegExp`, and non-`Uint8Array` typed arrays previously fell through to a generic
  object-entries encoder that lost their type and often all content; they now fail closed instead
  of being encrypted as a different, wrong value. (#337)
- **Encryption migration journal rejects illegal phase transitions** — completing a migration from
  a freshly `prepared` journal (skipping conversion and verification entirely) is no longer
  possible; only a `committing` or `cleanup` phase may terminate. (#337)
- **Migration verification no longer re-scans already-verified stores on resume**, and a batch that
  reports progress without advancing its durable cursor is now rejected instead of being able to
  replay the same records indefinitely. (#337)
- **Desktop (Tauri) build never read persisted state back at cold boot.** The app's boot-time
  hydration called the raw IndexedDB-only `dbService.loadState()` unconditionally, with zero Tauri
  branching, while every save path already routed through the Tauri-aware `storageService` — every
  desktop launch loaded as a brand-new user regardless of what was actually saved to disk (a strict
  superset of the reported "appearance preference doesn't persist" symptom). Boot-time hydration
  (`services/appBootstrap.ts`) now mirrors the save path, branching on `isTauriRuntime()`. The
  first-ever-launch settings default (`appearancePreset`) is also reconciled between
  `idbProjectStore.ts`'s normalizer and `settingsSlice.ts`'s deliberate `'sepia'` initial state, and
  quitting the desktop window now awaits any pending 1s-debounced project/settings autosave
  (`services/desktop/desktopTray.ts`) before the process actually exits, instead of allowing a quit
  to land mid-debounce and silently drop the last edit. (#332)
- **`SettingsView` re-rendered its entire tree on every unrelated Redux state change** —
  `useSettingsView`'s return value was a fresh object every render (no memoization), so any
  background write anywhere in the app (autosave, AI copilot, progress tracker) forced every
  Settings component to re-render even while a completely different view was in the foreground. The
  context value is now memoized against its actual dependencies. (#332)
- **AI Writing Studio manuscript text was unreadable, with selection/caret position drifting from
  the visible text.** `ContextPanel.tsx`'s real (input-handling) textarea sat invisibly over a
  separate visible text-mirror layer; the shared `Textarea` primitive's unconditional
  `backdrop-blur-md` blurred the mirror text underneath, the two layers resolved different concrete
  font stacks for the same font setting (different glyph metrics → position drift), and neither
  layer synced its scroll position with the other. `components/manuscript/ManuscriptEditor.tsx`
  (the primary writing surface) used the same fragile pattern and carried the same blur/scroll-sync
  defect. Fixed via a new `Textarea` `variant="overlay"` (no glass background/blur/reserved
  padding/mic button) and a single shared `services/editorTypography.ts` font-stack resolver used
  by both the real textarea and its mirror in both components, plus one-directional scroll sync
  from each real textarea to its mirror. (#341)
- **Overlay-variant textareas dropped RTL font resolution, custom-font selection, and dictation.**
  `resolveEditorFontFamily` now also takes the active text direction and `settings.customFont?.name`
  (previously every `editorFont: 'custom'` silently rendered as JetBrains Mono, and RTL sessions used
  LTR font stacks); the new `DictationButton` component restores the microphone entry point that
  `variant="overlay"` had unconditionally removed from both Writer Studio and the manuscript editor,
  rendered as a sibling above the mirror instead of inside `Textarea` itself. Also fixes two related
  scroll-sync gaps: the mirror now resets to the top on a section switch instead of showing a stale
  offset, and re-syncs after debounced/deferred content growth instead of staying clamped to a
  since-invalid scroll range. (#341, #344)
- **Voice model download progress bar looked stuck at ~95% for most of the download.**
  `voiceCommandService.ts`'s download progress handler treated transformers.js's `progress` field
  as if it were already a 0-1 fraction; it's actually 0-100 (percent), so the existing
  `Math.min(0.95, pct)` safety clamp kicked in almost immediately (any progress value over 0.95%,
  i.e. after the very first chunk of the download) and stayed there until the download's final
  "complete" dispatch. Now derives the fraction from the payload's real `loaded`/`total` byte
  counts (falling back to `progress / 100` only when those are absent). (#333 item 1)

### Docs

- Closed out the [PR #310 reconciliation ledger](docs/PR-310-RECONCILIATION.md) as **superseded** —
  #335/#336/#337 are merged into `main`, satisfying the one condition its merge decision previously
  left open. PR #310 itself was never merged; its own branch remained non-resumable throughout.
- Opened, then closed in this same release, [issue #338](https://github.com/qnbs/WorldScript-Studio/issues/338)
  tracking the Phase-4 work: wiring the migration journal to a real disable/passphrase-rotation UI
  flow, primary IDB-store adapters, and the two above race-condition fixes' production reachability
  — all landed via #342/#343 (see "Added" above).

## [1.26.0] — 2026-08-01

### Added

- **Opt-in native desktop notifications** now report completed encrypted-library and manuscript
  exports, updater readiness, and ProForge stage completion through the Tauri notification plugin.
  Permission is requested only after the user enables the setting, web builds remain a no-op, and
  the settings migration defaults existing installations to disabled. (#306)

### Changed

- **Local-inference worker capacity now follows the detected memory tier**: low-memory devices use
  one inference worker, the default remains two, and high-memory devices may use three. Detection
  failures safely retain the two-worker default. (#305)
- **`WorkerBus` is now an authoritative, event-driven priority scheduler.** Tasks dispatch only
  after leaving the bounded queue; worker availability events replace animation-frame polling;
  retries re-enter the scheduler without duplicating logical handles; and an eight-task critical
  reserve bounds total queue growth while retaining emergency capacity. (#307)

### Fixed

- **Worker tasks can no longer remain pending indefinitely after queue saturation or inactivity.**
  The progress-rearmed inactivity watchdog now starts at enqueue, covers both queue wait and active
  execution, retries recoverable timeouts, and replaces presumed-wedged workers without returning
  them to the idle pool. Worker-construction, replacement, cancellation, retry-backpressure,
  shutdown, and pool-termination failures all settle through one cleanup path. (#305, #307)
- **Completed tasks are removed from live scheduler state**, so more than 32 lifetime submissions
  no longer trigger false `BACKPRESSURE`; priority order and FIFO-within-tier are preserved under
  saturation, and completed progress iterators terminate instead of hanging. (#307)
- **The E2E API-key setup helper uses an exact configured-status match**, avoiding strict-locator
  ambiguity between the status badge and its descriptive label. (#307)

### Tests

- Added direct regressions for queue drain and reuse, priority ordering, critical reserve bounds,
  queued and active timeouts, fresh retry tokens, cancellation, shutdown, pool termination,
  constructor/replacement failures, listener/timer cleanup, and progress-iterator completion.

## [1.25.0] — 2026-07-31

### Added

- **Grok (xAI) wired into the primary provider dropdown** — the backend (`streamGrok()`, BYOK key
  storage, `/v1/models` connection test) already worked; it just wasn't reachable from
  `AiProviderCard.tsx`'s main flow. Added the key input + model selector (`grok-3`/`grok-3-mini`),
  a `providerToKind()` case for the newer Vercel-AI-SDK layer, and fixed the whole provider array's
  i18n (several labels were hardcoded literals). See [ADR-0016](docs/adr/0016-native-grok-and-claude-providers.md).
- **Claude (Anthropic) now works on desktop** — `streamAnthropic()` threw unconditionally on every
  platform; CORS is a browser-only restriction, so desktop now calls Anthropic directly via the
  same native-HTTP escape hatch [ADR-0012](docs/adr/0012-local-server-connectivity-tauri-http.md)
  established for Ollama. Desktop Settings now shows a real key input + model selector
  (Opus 4.7/Sonnet 4.6/Haiku 4.5) instead of a warning-only block.
- **Claude (Anthropic) now works on the web/PWA** (Vercel, Cloudflare Pages) via a new stateless
  serverless proxy (`api/claude-proxy.ts` + `functions/api/claude-proxy.ts`) — this app's first
  backend dependency ever. Schema-validated, body-size-capped, same-origin-checked, rate-limited,
  and timeout-bounded; never logs the API key, prompt, or response. GitHub Pages (static-only,
  can't host the proxy) shows an honest "not available on this deployment" state instead of a
  silent failure. This is the one provider whose BYOK key transits WorldScript's own infrastructure
  in the web build — documented plainly in `docs/SECURITY-THREAT-MODEL.md` and README's privacy
  framing, not folded into the general "direct browser→provider" claim every other provider gets.
- **Opt-in direct browser→Ollama connection in the web/PWA build** (`enableBrowserOllama`, default
  off, Settings → Experimental) — for users who start their own Ollama server with `OLLAMA_ORIGINS`
  covering the page's exact origin, matching NovelCrafter's real (non-proxy) browser-Ollama model.
  Not a bypass and not the default: desktop remains the recommended, zero-config path. The Settings
  UI renders the exact `OLLAMA_ORIGINS=<origin> ollama serve` command for the current deployment.
  See [ADR-0017](docs/adr/0017-pwa-browser-ollama-opt-in.md) (Issue #266 follow-up).

### Security

- **DuckDB `codex_mentions.excerpt` — the one analytics column holding literal manuscript prose —
  is now cell-level encrypted (SEC-6)** when `enableIdbAtRestEncryption` is active.
  `duckdbCodexWrite()` (`services/duckdb/duckdbAnalytics.ts`) encrypts new excerpts via
  `services/duckdb/duckdbEncryption.ts` (AES-256-GCM, reusing the IDB at-rest encryption key) into
  a new `excerpt_enc BLOB` column and nulls the plaintext `excerpt` column; a new backfill
  migration (`services/duckdb/codexExcerptEncryptionMigration.ts`) re-encrypts any pre-existing
  plaintext rows once encryption is unlocked, without blocking the schema's other migrations when
  encryption isn't active this session. Full OPFS **file-level** encryption remains infeasible —
  DuckDB-WASM owns the OPFS file handle directly, leaving no app-level interception point — so the
  other DuckDB metadata columns (`title`/`logline`/`name`/`character_names`/`label`) stay
  intentionally plaintext by design, not manuscript prose.
- **SEC-6 backfill migration marker was a single global key, not scoped per project** —
  once *any* project completed the excerpt-encryption backfill, every other project's
  plaintext `codex_mentions.excerpt` rows were silently never migrated.
  `isCodexExcerptEncryptionMigrationDone()` now takes a `projectId` and scopes the `_meta`
  done-marker key per project. Also fixed `duckdbCodexWrite()`'s `ON CONFLICT` clause for
  `codex_mentions` so an unencrypted write (a session where IDB encryption isn't unlocked yet)
  can no longer clobber an existing ciphertext row back to plaintext — it now preserves any
  prior `excerpt_enc` via `COALESCE`/`CASE` instead of overwriting it. Added a two-project
  regression test proving the marker-scoping fix and a test asserting the `ON CONFLICT` clause
  never downgrades ciphertext. (CodeRabbit + Copilot review, PR #303)
- **A failed per-row `UPDATE` during the SEC-6 excerpt-encryption backfill could still let the
  migration write its done-marker** — the row's plaintext `excerpt` would then never be retried
  or encrypted on any future run. `runCodexExcerptEncryptionMigration()` now tracks row-level
  failures (a failed `UPDATE`, or `encryptDuckDbData()` throwing) and skips the done-marker,
  returning `{ aborted: true }` so the still-plaintext rows are retried next run instead of being
  silently left unencrypted forever. (CodeRabbit outside-diff-range finding, PR #303)

### Fixed

- **`event-listener` (Rust, transitive via Tauri) bumped 5.4.1 → 5.4.2** — the OSV/RUSTSEC scan
  flagged 5.4.1 as vulnerable (RUSTSEC-2026-0221), fixed upstream in 5.4.2; `Cargo.lock` only,
  no other dependency churn.
- **Doc-drift gate (`scripts/check-doc-metrics.mjs`) had a blind spot for still-open checklist
  bullets inside dated/historical sections**: `stripHistoricalSections()` blanked every line in a
  historical section indiscriminately, including a genuinely still-open `- ⬜` bullet — exactly how
  a stale "Tag `v1.24.2`" bullet escaped the gate in a same-day doc edit (`dc14bc0`). `OPEN_BULLET`
  now gets the same "always present-tense, never stripped" treatment `DONE_BULLET` already had for
  the opposite polarity. `scanForDrift()` also gains a new check: a surviving open bullet
  mentioning tag/release/publish (including inflected forms — "Tagging"/"Releasing"/"Publishing")
  of a version `<=` the latest git tag is now flagged as drift. (#293)

### Docs

- **`CLAUDE.md` codifies three merge-discipline lessons** learned during the PROMPT-WSS-v1.24.x
  recovery sprint: never commit directly to `main` (always branch + PR, even for a single-file
  change); wait for the **full** CI suite — including non-required/advisory jobs like E2E,
  Storybook, Lighthouse, and Visual Regression — to go green before merging, not just the
  branch-protection-required checks; and group related small workstreams into the fewest
  reviewable PRs by natural/documented boundaries rather than one PR per tiny item, while keeping
  one commit per logical concern. Also adds a "Known merge-gate quirks" section distinguishing
  GitHub's real pending-check block from this repo's own stricter wait-for-pass policy and the
  mergeable-state cache-lag symptom, plus documents the stacked-PR auto-close-on-squash-merge
  side effect and its recovery steps; and strengthens the CodeAnt Correction Loop policy to
  explicitly cover CodeRabbit's collapsed nitpick and outside-diff-range comment sections. (#294)
- **`.github/SECURITY.md` / `docs/SECURITY-THREAT-MODEL.md` SEC-6 status corrected** to reflect the
  DuckDB excerpt-encryption wiring above, and the Claude serverless proxy section gains an explicit
  monitoring recommendation (platform-native Vercel/Cloudflare request analytics — no in-app
  logging, which would violate the proxy's zero-console-call stateless guarantee).
- **`docs/history/GROK-PROVIDER-INTEGRATION-PLAN.md`** status header updated from "Plan only — do not implement
  yet" to reflect that all phases shipped; retained as the historical design record.
- **`TODO.md`** reworded the open tag/publish bullet so it no longer embeds the literal `v1.25.0`
  version string on the `- ⬜` bullet line itself, removing the risk that
  `scripts/check-doc-metrics.mjs`'s `scanForDrift()` would flag it as stale drift once the
  `v1.25.0` tag is actually pushed (verified via a `scanForDrift()` simulation with
  `latestVersion: '1.25.0'` — zero findings).
- **`docs/SECURITY-THREAT-MODEL.md`** now names the specific platform observability products
  (Vercel Function Logs / Vercel Observability; Cloudflare Workers Metrics/Analytics and Workers
  Logs) instead of a vague "platform-native analytics" reference, and notes that Cloudflare
  Workers Logs is opt-in and must be enabled via the Wrangler `observability` config.

### Tests

- **Closed 3 Codecov patch-coverage gaps found on PR #303**: the DuckDB analytics migration
  listener in `app/listenerMiddleware.ts` was never exercised by any test at all (stale mocks —
  `loadDuckdbMigration`'s mock returned `runIfNeeded`, but the real listener calls
  `runMigrationWithRollback`; `loadRagVectorMigration`'s mock resolved `undefined` where the
  listener reads `.aborted`) — fixed the mocks and added 2 tests covering both branches of the
  `codexEncResult.aborted` gate. Added 5 tests for `codexExcerptEncryptionMigration.ts` (a
  post-loop privacy-gate abort distinct from the existing mid-loop-abort case, a failed row
  `UPDATE` that now aborts without writing the done-marker, a row-encryption throw that aborts
  the same way, and the `migrated % 10 === 0` yield-point). Added a test for `useDuckDb.ts`'s new
  v3 migration DDL failure branch.

## [1.24.3] — 2026-07-30

> Worker-generation consolidation sprint: the v1/WorkerBus-v2 duplication [ADR-0014](docs/adr/0014-worker-generation-duplication.md)
> deferred is now closed out. Executed as 5 stacked PRs (#286–288, #290–291), plus the independent
> #289 (Vercel auto-deploy pause); see
> [ADR-0015](docs/adr/0015-worker-generation-consolidation.md) for the full decision record. This
> release also recovers a merge queue interrupted mid-session by a local editor crash — all five
> PRs required a fresh sync-merge conflict resolution against the accumulated fixes below before
> landing; see `docs/audit/` for the run log.

### Changed

- **DuckDB analytics and local inference (embeddings + NLP) now route through WorkerBus v2**,
  replacing dedicated `new Worker(...)` instances per service. `services/duckdb/duckdbClient.ts`,
  `services/ai/localEmbeddingService.ts`, and `services/ai/localNlpService.ts` keep their exact
  public APIs — an adapter pattern, not a consumer rewrite, so none of their real callers needed
  changes. `ensureDuckDbPool()`/`ensureInferencePool()` added to `services/workerBusManager.ts`,
  decoupled from `enableWorkerBusV2` (mirrors the existing `ensureWebLlmPool()` pattern — these are
  core features, not experimental infra).
- The shared `inference` WorkerBus pool's `maxWorkers` capped at 2 (was 4) — each replica
  independently loads its own transformers.js pipeline with no cross-replica cache sharing, so 4
  concurrent workers under a burst could mean 4x the model memory footprint.
- **Vercel auto-deploy paused mid-term** after 2 consecutive preview-deployment failures with only a
  generic "Deployment has failed" message and no reproducing local failure — GitHub Pages and
  Cloudflare Pages remain live and unaffected while the platform-side cause is investigated.

### Fixed

- **DuckDB query/exec parameters were silently dropped**, executing an unbound query — already live
  and breaking `services/ai/telemetryService.ts`'s parameterized `INSERT` writes. Fixed via
  DuckDB-WASM prepared statements.
- **`WorkerBus.terminatePool()` could leave tasks hanging forever** — removing a pool didn't settle
  tasks already routed to it. Fixed by tracking task→pool assignment and cancelling matching tasks
  before removal; a pool removed this way is now also transparently re-registered on next use
  instead of failing every subsequent call.
- **A respawned DuckDB worker lost its connection**, failing every query after an idle timeout with
  "DuckDB not initialized." Fixed by transparently re-initializing once and retrying.
- **DuckDB's OPFS-unavailable fallback silently swallowed the failure**, giving users no warning
  their analytics wouldn't persist across reloads (private browsing, old Safari) — restored via the
  existing progress channel. A follow-up fix made the fallback's own cleanup step best-effort, so a
  secondary failure there can no longer block the fallback path itself.
- **A missing `ensureInferencePool` export broke production builds** on Vercel (rolldown's
  `[MISSING_EXPORT]`) — not caught by Vitest (the consumer test mocks the whole module) or by local
  `tsgo` typecheck. Root-caused by reproducing Vercel's *exact* build command
  (`pnpm run build:edge`, which differs from the plain `pnpm run build` used for an earlier,
  misleading local repro attempt) and fixed by adding the missing function.
- **A reused `AbortSignal` leaked one `'abort'` listener per call** in `duckdbClient.ts`'s `send()`
  — `{once: true}` only self-removes once the signal actually fires, so a caller reusing one signal
  across many non-aborted queries (a common hook/thunk pattern) accumulated listeners for the
  signal's whole lifetime. Fixed with an explicit `finally`-block `removeEventListener`.
- **`ensureDuckDbPool()`/`ensureInferencePool()` could reject instead of degrading gracefully** —
  their pool re-registration helpers awaited a lazy import and called `registerPool()` without a
  catch, so a re-registration failure after the bus was already live broke the documented "returns
  null only if init failed" contract. Both now log the failure and return the live bus instead of
  propagating the rejection.

### Removed

- `workers/duckdbWorker.ts` and `workers/inference.worker.ts` (the v1 worker generation) — both
  workloads now exclusively use `workers/v2/duckdb.worker.ts` and `workers/v2/inference.worker.ts`.

## [1.24.2] — 2026-07-29

> CSP functional-truth, desktop crypto, and documentation-truth hardening sprint
> (`PROMPT-WSS-v1.24.x`). Headline fix: `script-src` shipped without `'wasm-unsafe-eval'` for two
> months (2026-05-27 → 2026-07-29), silently blocking `WebAssembly.instantiate` in every deployed
> Chromium browser — the entire advertised local-inference stack (WebLLM, ONNX Runtime Web,
> Transformers.js, DuckDB-WASM, Whisper-STT, Kokoro-TTS) never functioned in production. No gate
> caught it because the only CSP tests that existed checked cross-surface consistency, never
> functional correctness. See [`docs/adr/0013-csp-wasm-and-blob-frames.md`](docs/adr/0013-csp-wasm-and-blob-frames.md)
> and [`docs/audit/WS-RUN-LOG-2026-07-29.md`](docs/audit/WS-RUN-LOG-2026-07-29.md) for the full record.

### Security

- **F-01/F-02 — CSP functional truth.** `'wasm-unsafe-eval'` (never the broader `'unsafe-eval'`)
  and `frame-src 'self' blob:` added to all 5 deployment surfaces (`index.html`, `vercel.json`,
  `public/_headers`, `nginx.conf` ×3, `src-tauri/tauri.conf.json`). The unhashed inline
  `aurora-disabled` script that shipped alongside the broken CSP moved into `index.tsx` as a
  same-origin module. New 3-layer test architecture (`tests/unit/cspCorrectness.test.ts` + a
  hardened `scripts/smoke-prod-build.mjs` with real CSP-violation and WASM-instantiate probes)
  so this class of defect can't silently recur.
- **F-05/F-06 — desktop API-key encryption.** `services/fs/fsCore.ts`'s key derivation used a
  single unsalted SHA-256 digest of publicly-derivable material — fixed to PBKDF2 (600,000
  iterations) + a random 32-byte salt, matching the existing `storageEncryptionService.ts`
  pattern. Pre-existing key files are discarded (not migrated) with a one-time notification
  prompting re-entry. **Correction (2026-08-13):** this hardened the KDF against rainbow-table
  and multi-target reuse, but the derivation *input* itself — `${appDataPath}|${provider}|WorldScriptStudio|v1`
  — remained fully public/reconstructible, so the root "obfuscation, not encryption" finding was
  never actually closed. Tracked as an open gap — see `docs/IDB-ENCRYPTION.md` § Tauri Desktop Layer
  and `AUDIT.md`'s F-05/F-06 row for current status. **Review-loop follow-up (2026-08-13):**
  `docs/SECURITY-THREAT-MODEL.md`'s Desktop Local File-Read Attack Tree and document header still
  called this "fixed" and said reading the ciphertext no longer reveals the key material, directly
  contradicting the corrected Mitigation Mapping row above it — reconciled to say "not resolved"
  consistently throughout. Also documented a separate, unrelated functional bug surfaced while
  fact-checking this row: `components/ApiKeySection.tsx` never adopted the `storageService`/
  `FsSettingsStore` path this desktop API-key row describes — it still reads/writes the Gemini key
  through `dbService` (IndexedDB) even on desktop, while `services/geminiService.ts` reads through
  `storageService` (filesystem on desktop), so a Gemini key saved via Settings → AI on desktop is
  invisible to the code that actually uses it. Tracked in
  [#358](https://github.com/qnbs/WorldScript-Studio/issues/358); not fixed by this entry.
  **Second review-loop follow-up (2026-08-13):** tightened the attacker-capability wording (needs
  both the ciphertext *and* the public derivation inputs, not the ciphertext alone) in both the
  Mitigation Mapping row and the attack tree; added the same Gemini-exception note to the attack
  tree (previously only in the table row); and added a new Mitigation Mapping row for desktop
  project/settings/snapshot/Codex/RAG/image/binder-asset data, which this threat model previously didn't
  mention at all despite it having neither confidentiality nor authentication on disk — real fix
  in progress on [PR #356](https://github.com/qnbs/WorldScript-Studio/pull/356).
- **F-08 — Tauri/web `connect-src` completeness.** Added LanguageTool's default self-hosted port
  (missing on **all 5** surfaces, not just Tauri) and the Hugging Face hosts WebLLM/Transformers.js
  actually resolve models from, including the Xet CDN bridge (`us.aws.cdn.hf.co`) that real model
  weight downloads redirect to — traced empirically, not assumed.
- **F-09 — DuckDB-WASM self-hosted.** Replaced an unversioned, unreachable (already CSP-dead)
  third-party CDN with assets copied from the pinned `@duckdb/duckdb-wasm` npm dependency at build
  time (`scripts/copy-duckdb-assets.mjs`), never committed to git.

### Fixed

- **F-07 — doc truth-up.** README/CLAUDE.md no longer make a blanket "encrypted at rest" claim;
  a fabricated `tauri-plugin-stronghold` reference (no trace of that dependency anywhere in the
  repo) removed and replaced with the actual mechanism per platform.
- **F-10 — canonical production URL unified.** A dead preview-deployment domain
  (`worldscript-studio-indol.vercel.app`, confirmed 404) had drifted into the in-app link and the
  Italian locale; both now reference a single `PRODUCTION_URL` constant. New drift gate in
  `scripts/check-doc-metrics.mjs`.
- **F-12 — CI Storybook deduplication + a genuine broken test-runner invocation.** Storybook was
  built 3× per CI run; deduped to 1×. While evaluating whether the Storybook test-runner's
  `|| true` could be made blocking, found the invocation was calling flags
  (`--max-workers`/`--retries`/`--screenshot-on-failure`) the installed CLI version doesn't
  support — every prior run failed on argument parsing before executing a single story, silently
  turned green by `|| true`. Fixed the invocation and moved the non-blocking behavior to
  step-level `continue-on-error: true`, which still surfaces genuine failures in the Actions UI.
- **F-13 — coverage ratchet raised** to CI-measured values (L79/F72/B65/S77, from L74/F67/B60/S72).
- **Pre-existing a11y color-contrast failure (out of scope, fixed proactively).** The CI a11y
  E2E gate caught `WriterViewUI.tsx`'s Writer/ProForge version-control and Focus Mode toggles
  using `--sc-accent`-derived text on a tinted `--sc-accent` background — 4.47:1 on the sepia
  theme, below WCAG AA's 4.5:1. All 4 occurrences (2 desktop, 2 mobile, across two different
  broken token combos) now use the pre-vetted `--nav-background-active`/`--nav-text-active`
  pair already used for nav active-states elsewhere.

### Documentation

- **F-04 — CSP gate governance.** `docs/CI.md` gains a "which layer catches which failure class"
  table and a post-mortem on why cross-surface-consistency tests alone were never sufficient.
- **F-14 — worker-generation duplication documented** (`docs/adr/0014-worker-generation-duplication.md`).
  Both a v1 and a WorkerBus-v2 generation of the DuckDB and local-inference workers are live via
  real call chains; consolidating them is a properly-scoped migration effort of its own, tracked
  but out of scope for this sprint.

## [1.24.1] — 2026-07-28

> Local-AI reliability (desktop Ollama/LM Studio/vLLM discovery, misleading browser status badge),
> the AI heuristic-fallback foundation + Outline/Character/World/Plot-Board generators, real
> self-hosted LanguageTool integration, a 20-PR Dependabot backlog triage (16 merged directly,
> 4 closed as superseded after the AI SDK v4 family/biome 2.5.x/dev-tooling-Babel-8 blockers were
> root-caused and fixed), the Issue #60 vendor-fork audit
> closeout, and security/build hardening (`persist-credentials` CWE-522, `ltr`/`rtl` Tailwind fix,
> 3 ineffective dynamic imports, 2 CWE-209 fixes).

### Added

- **Heuristic fallback for Plot-Board "suggest next beat".** Completes offline coverage of the
  structured generators: when AI is unavailable, the Plot Board now offers localized, framework-based
  next-move suggestions (raise the stakes / introduce a complication / add a reversal) with rationale,
  instead of an error. See [`docs/AI-HEURISTIC-FALLBACKS.md`](docs/AI-HEURISTIC-FALLBACKS.md).

- **Heuristic fallback for Character & World profiles.** When AI is unavailable, the Character and
  World generators now produce a schema-valid, localized **starting profile** (structured fields with
  the user's concept woven in; empty `timeline`/`locations` for World) instead of an error toast —
  extending the offline heuristic coverage to two more structured generators. Same pure-generator +
  hook-resolved-labels pattern as the Outline fallback. See
  [`docs/AI-HEURISTIC-FALLBACKS.md`](docs/AI-HEURISTIC-FALLBACKS.md).

- **Heuristic fallback for the Outline Generator.** The first per-feature heuristic on the fallback
  foundation: when AI is unavailable the outline generator now produces a structurally-sound,
  schema-valid chapter skeleton — a three-act beat sheet scaled to the requested chapter count
  (setup → inciting incident → rising action / midpoint / complications → optional twist → climax →
  resolution) with the user's idea woven in — instead of just showing an error. Fully offline and
  localized (the hook resolves `outline.heuristic.*` labels; the generator stays pure). See
  [`docs/AI-HEURISTIC-FALLBACKS.md`](docs/AI-HEURISTIC-FALLBACKS.md).

- **AI heuristic-fallback foundation.** Groundwork so AI features can degrade gracefully (offline,
  quota, error, Eco/Heuristics-only mode) instead of hard-failing. A pluggable heuristic-generator
  registry (`services/ai/heuristicFallback/`, modeled on the Copilot rule engine) + a shared
  `HeuristicFallbackResult` envelope (reuses ProForge's `isFallback` + a calibrated `confidence`), wired
  into the provider choke points that previously had no degrade path — `generateText`'s terminal,
  `generateJson` (Gemini-direct), and `streamText`. A `useHeuristicFallback()` hook + reusable
  `AssistedModeBadge` surface the "Assisted (offline)" state and record fallbacks to telemetry. Ships
  **inert** (no per-feature generators yet → unchanged behavior); see
  [ADR 0011](docs/adr/0011-ai-heuristic-fallbacks.md). Per-feature generators (Outline/Character/World,
  Writing Studio tools, analysis tools) land in follow-up PRs.

- **Real LanguageTool grammar & spelling integration (self-hosted, privacy-first).** Replaces the
  hardcoded fake-typo list with a real, multilingual proofreader running on the user's own machine.
  Two surfaces share one offset-safe apply path (`hooks/useLanguageToolCheck.ts`): an on-demand
  **"Check this scene"** panel in the Writer tools sidebar (findings list → apply / ignore /
  add-to-dictionary) and a **live inline overlay** in the manuscript editor (debounced underline +
  suggestion popover, reusing the existing aligned-overlay infrastructure). New
  `services/languageToolService.ts` (`checkText` → parse `matches[]`, text-hash cache, abortable,
  silent offline degrade, never logs text); the privacy gate (`assertLanguageToolAllowed`) keeps cloud
  servers blocked under local-only mode. Locale coverage is encoded in the SSOT `i18n/locales.ts`
  (`languageToolSupport` + `languageToolCode`, verified against dev.languagetool.org) and the feature
  is hidden for unsupported locales (tr/he/fi/hu/is/eu/ko). Opt-in via Settings → Connections; run a
  server with `docker run -p 8010:8010 erikvl87/languagetool`. See [`docs/LANGUAGETOOL.md`](docs/LANGUAGETOOL.md)
  and [ADR 0010](docs/adr/0010-languagetool-self-hosted.md).
- **Native Intel-Mac (x86_64) desktop builds — added, then reverted within this release.**
  `tauri-build.yml` briefly added `macos-13` (Intel) to the build matrix alongside `macos-latest`
  (Apple Silicon). In practice the `macos-13` hosted runner never provisions: the job sits in
  GitHub's queue indefinitely instead of starting, so its own `timeout-minutes: 45` never applies —
  and because the `release` job's `needs: [bundle]` only resolves once every matrix leg reaches a
  terminal state, this blocked the **entire** release for the full ~24h GitHub Actions queue ceiling
  even though Ubuntu/Windows/macOS-ARM finished in ~12 minutes. Removed `macos-13` from the matrix;
  Intel Mac builds are tracked as a re-opened follow-up in `TODO.md` pending a working Intel runner
  option. The `latest.json` generator's per-arch warning / hard-fail-only-if-no-arch-signs logic
  (added alongside the original matrix change) is unaffected and already tolerates the missing arch.
  See [`docs/TAURI-CI.md`](docs/TAURI-CI.md).
- **New Help article — "AI execution modes & OpenRouter".** Documents the four live-switchable
  execution modes (Hybrid / Cloud / Local / Eco) and OpenRouter's free tier + circuit breaker
  (4×429 → 5 min pause, RPM tracking), which shipped without a Help entry. Added to the AI Studio help
  category, deep-linking to Settings; translated into the five Production locales, English fallback for
  the other 14 (per the tag-dense-HTML help-body policy).
- **DeepSource static-analysis integration (token-free).** Added [`.deepsource.toml`](.deepsource.toml)
  (analysis-only — no autofix transformers, so it never fights Biome and needs no repo token; activates
  once the free DeepSource OSS app is installed). Auto-detects JavaScript/Rust/Docker/CSS analyzers.
  Complements the existing CI gate as a second review layer while CodeAnt's free-tier quota is
  exhausted. Process: [`docs/DEEPSOURCE-REVIEW-LOOP.md`](docs/DEEPSOURCE-REVIEW-LOOP.md) (living runbook,
  complements the CodeAnt one); backlog tracking: [`docs/DEEPSOURCE-REMEDIATION-PLAN.md`](docs/DEEPSOURCE-REMEDIATION-PLAN.md)
  (prioritised P0-security→P5-docs, with the triage principle: rule-ignore findings already governed by
  Biome/strict-TS/test convention, fix DeepSource-unique real issues).

### Changed

- **AI SDK family upgraded to v4/v7** (`ai` 6→7, `@ai-sdk/google`/`@ai-sdk/openai`/`@ai-sdk/react` 3→4).
  Bumped as one coordinated unit rather than merging the four Dependabot PRs individually — `@ai-sdk/google@4`
  emits the new `LanguageModelV4` spec, which the `ai` package's `LanguageModel` type only recognizes from
  v7 onward, so upgrading `@ai-sdk/google` alone (as Dependabot's #255 proposed) left
  `services/ai/providerFactory.ts` with a real `tsc` error. No application code changes were needed beyond
  the version bump — `streamText`/`toTextStreamResponse`/`onFinish`'s `usage` shape in
  `services/ai/worldScriptCompletionFetch.ts` and `createLanguageModelForWorldScript`'s `LanguageModel`
  return type in `services/ai/providerFactory.ts` are unaffected. Verified with `pnpm run typecheck`,
  `pnpm run lint`, and the full AI-provider/completion-fetch test suites (all passing).
- **Biome upgraded to 2.5.4** (from 2.4.16), migrated cleanly. Two new rules the version enables
  required real fixes, not suppressions: `lint/correctness/noUnsafeOptionalChaining` (4 test files —
  `(x?.[n] as T).prop`-style patterns split into a separate variable assignment so an optional-chain
  short-circuit can no longer throw at the point of use) and `lint/suspicious/noUndeclaredEnvVars`
  (16 environment variables used across scripts/config/tests weren't declared in `turbo.json`'s
  `globalEnv`, so Turborepo's cache correctness couldn't account for them — now declared). Also ran
  `biome migrate` for the `linter.rules.recommended` → `linter.rules.preset` config rename ahead of
  Biome's next major version.

- **Settings hygiene.** Removed stale Experimental-category search hints (`plot board`, `codex`,
  `cross project` — retired/promoted flags) in favor of current features; `ProForgeDashboard` now
  uses the catalog-driven `MaturityBadge` instead of a hard-coded Experimental pill, keeping the
  v1.24 maturity-label convention consistent.

- **Desktop settings "minimize to tray" is now a proper switch.** `DesktopSection` used the only raw
  `<input type="checkbox">` left in Settings, with its hint not programmatically associated. It now
  renders the design-system `ToggleSwitch` (`role="switch"`, `aria-labelledby` + `aria-describedby`
  hint, focus-visible ring, RTL-aware), matching every other Settings control — consistent styling and
  screen-reader behaviour. Added a `DesktopSection` component test (web no-op, accessible switch, state
  reflection, dispatch on toggle).
- **Help content truthfulness pass (post-release).** Two stale Help articles were corrected against
  code reality: **Languages** now states the real **19 interface languages** with their Production /
  Near-Production / Beta status tiers + the quality dashboard (was "seven languages — German, English,
  French, Spanish, Italian, plus Arabic and Hebrew"); **Feature flags** now states **22 flags
  (16 default-on / 6 opt-in)**, explains the grouped-by-maturity Experimental UI with dependency-aware
  disabling, and drops the bullet for the removed `enableWebnnInference` flag (the WebNN execution
  provider is still described as an adaptive-engine backend). Refreshed in the five Production locales.
- **ProForge is now opt-in (default off).** The experimental 8-stage agentic editing pipeline
  (`enableProForge`) shipped on by default; it is token-heavy and carries loop risk, so it is now a
  user opt-in like Voice and the Global Copilot. New installs get **16 default-on / 6 default-off**
  flags. Existing users who enabled or relied on it are unaffected (the persisted value wins);
  everyone can still turn it on under Settings → Experimental.
- **Settings → Experimental features are grouped by category** (Writing, AI, Editing Pipeline,
  Performance, Voice, …) with maturity + risk hints, dependency-aware disabling (a flag whose
  prerequisite is off — e.g. Voice WASM without Voice Support — is disabled with an explanation), a
  "Desktop app only" note for Rust Compute, and a **Reset to defaults** action.
- **Voice-nightly annotation cleanup.** The informational `voice-nightly.yml` real-Whisper job no
  longer surfaces a red "Process completed with exit code 1" annotation when the HF-CDN model download
  times out (a known transient). The download step is now step-level `continue-on-error` with a
  bounded 2-attempt retry, and a summary step writes the pass/fail signal to `$GITHUB_STEP_SUMMARY`,
  so the nightly signal is preserved without the misleading error annotation.

### Fixed

- **`pnpm run build` warnings: invalid `[dir:ltr]`/`[dir:rtl]` Tailwind arbitrary variants and 3
  ineffective dynamic imports.** `ToggleSwitch`'s thumb translate used a malformed custom variant
  (`[dir:ltr]:translate-x-5 [dir:rtl]:-translate-x-5`) that Tailwind compiled to the invalid CSS
  pseudo-class `:is(dir:ltr)` (lightningcss minify warning on every production build) — replaced
  with Tailwind's built-in `ltr:`/`rtl:` direction variants, which correctly target the `dir`
  attribute `App.tsx` already sets on `<html>`. Separately, Rolldown flagged 3 dynamic `import()`
  calls (`app/transientUiStore.ts`, `services/ai/ecoModeService.ts`, `services/spotlightTour.ts`)
  as unable to move their module into a separate chunk because each was also statically imported
  elsewhere in the eager bundle — converted all three call sites to plain static imports, removing
  the dead-weight async indirection with no bundle-size change.
- **PR #274 review findings that failed to post inline (CodeRabbit/GitHub API error).** A rate-limited
  re-review posted its 10 findings as review-body text instead of inline comments; the 2 that did
  post (missing `persist-credentials: false`) were already fixed. Of the 7 that only existed in the
  review body text: `AiProviderCard`'s status badge now has `role="status" aria-live="polite"`; a
  stale in-flight connection-test result (CWE-209) could overwrite `testError` after switching to
  Ollama-in-browser — added a monotonic request-id guard in `handleTest` and gated the action-row
  error span with the same `!ollamaUntestable` check the paragraph above it already used;
  `ollamaService.ts`'s `plugin_unavailable` branch returned `LocalServerError.message` directly (a
  public class whose message isn't guaranteed safe for every kind) — now builds its own fixed safe
  string, matching the `timeout`/`unreachable` branches; and a scan-endpoint test asserted a loose
  `/models` substring instead of the exact `/v1/models` path. The remaining findings (missing
  `// QNBS-v3:` comments on several already-commented files/lines; `services/CLAUDE.md`'s
  LanguageTool wording) were verified already covered by existing file-level rationale comments or
  already fixed in an earlier commit — not re-applied to avoid redundant/stale documentation.
- **Ollama / LM Studio / vLLM discovery & connectivity on desktop, CORS noise in the PWA
  (#266).** Root cause: all local-server traffic (`services/ollamaService.ts`,
  `scanLocalOpenAiCompatibleEndpoints()`) used the WebView's `fetch`, so inside the Tauri shell the
  cross-origin `localhost` requests died on CORS/PNA, and in the PWA the settings auto-effect probed
  `localhost:11434` on every visit (loud CORS console errors). All local-server calls now go through
  the new thin `services/localServerHttp.ts`, which routes via `@tauri-apps/plugin-http` (native,
  CORS-free) on desktop and keeps browser `fetch` on the web, with shared URL normalization, timeout
  composition and `unreachable`/`timeout` classification (user aborts still propagate unchanged).
  The Settings → AI card no longer auto-probes localhost in the PWA — it shows a quiet "desktop app
  required" banner with a download CTA instead — and the desktop scan gained per-endpoint status
  badges (reachable / no response / timeout / HTTP error) plus a one-click **Use this URL** action.
  All new strings localized in 19 locales. See
  [ADR 0012](docs/adr/0012-local-server-connectivity-tauri-http.md) and
  [`docs/LOCAL-AI.md`](docs/LOCAL-AI.md).

- **Desktop Ollama/LM Studio/vLLM discovery still broken in packaged builds after #269 (#266).**
  Root cause: `vite.config.ts`'s `rollupOptions.external` unconditionally externalized every
  `@tauri-apps/*` package from **every** `vite build`, including the exact build Tauri's
  `beforeBuildCommand` invokes to produce the `.deb`/`.msi`. Since `services/localServerHttp.ts`'s
  `@tauri-apps/plugin-http` import is dynamic, this left an unresolvable bare module specifier in
  the shipped desktop bundle — every caller's catch classified the resulting load failure
  identically to a genuinely-down server (no CORS noise, no discovery, even with Ollama/LM Studio
  running). `tauri dev` was unaffected (Vite's dev server doesn't apply `rollupOptions`), so the
  regression only surfaced in packaged builds. Fixed by extracting the existing Tauri-build
  detection (`resolveViteBase.ts`'s `TAURI_ENV_PLATFORM`/`TAURI_PLATFORM` check) into a shared
  `isTauriBuild()` export and making the external array conditional on it; the web/PWA build is
  unaffected. `localServerHttp.ts`'s `resolveFetch()` also now classifies a plugin load failure as
  a distinct `LocalServerError('plugin_unavailable')` (logged), instead of folding it into
  `'unreachable'`. See the 2026-07-28 update in
  [ADR 0012](docs/adr/0012-local-server-connectivity-tauri-http.md).

- **Misleading "Ready" status badge for Ollama in the browser (#266).** The generic connection-status
  badge in `AiProviderCard` and the "desktop app required" banner were driven by two independent,
  never-reconciled state signals — `testStatus` (defaults to `idle` → "Ready"/"Bereit") and
  `isDesktop`. Since the auto-test effect and the manual "Test connection" button are both disabled
  for Ollama in a browser, `testStatus` could never leave its idle default there, so the badge always
  read "Ready" right next to a banner saying the opposite. It now shows a distinct "Not available in
  browser" label instead whenever `provider === 'ollama' && !isDesktop`, localized in all 19 locales;
  desktop is unaffected. Also: `scanLocalOpenAiCompatibleEndpoints()` now tries Ollama's native
  `/api/tags` first, falling back to the OpenAI-compat `/v1/models` shim only on failure (mirrors
  `testOllamaConnection`/`listOllamaModels`'s existing native-first approach), so an older Ollama
  install without the compat shim isn't missed by the scan.

- **Feature-catalog / slice default drift made structurally impossible.** `features/featureCatalog.ts`
  now covers all **22** flags (was 16) and **derives** each entry's `defaultOn` from the slice's
  `defaultFeatureFlagsState` instead of hand-keying it — the class of bug where the catalog said
  `false` while the slice said `true` for ~12 flags can no longer recur (guarded by the new
  `tests/unit/featureCatalog.test.ts`). Added risk-level / desktop-requirement / dependency metadata.

### Security

- **GitHub Actions workflows drop persisted checkout credentials (CWE-522, zizmor/CodeRabbit).**
  `actions/checkout` leaves the `GITHUB_TOKEN` in the local git config by default so later steps can
  push; none of the jobs across `ci.yml` (8 checkout steps), `codeql.yml`, `docker.yml`,
  `mutation.yml`, `storybook-debug.yml`, `tauri-build.yml`, or `voice-nightly.yml` push or commit
  after cloning, so the token had no reason to persist beyond the checkout step. All 14 checkout
  steps now set `persist-credentials: false`.
- **`@babel/core` security override bounded to the 7.x line, fixing a broken Storybook build.**
  The `pnpm-workspace.yaml` override for GHSA-4x5r-pxfx-6jf8 (`>=7.29.6`) had no upper bound, unlike
  every sibling override in the same block. When Babel 8.0.1 was published, pnpm resolved it for
  **every** consumer — including `react-docgen@8.0.3` (via the Storybook toolchain), which declares
  its own `"@babel/core": "^7.28.0"` and calls the synchronous `loadPartialConfig()`, removed in
  Babel 8 in favor of `loadPartialConfigSync()`. This crashed every Storybook build
  (`Error: Starting from Babel 8.0.0, the 'loadPartialConfig' function expects a callback`).
  Bounded to `>=7.29.6 <8`, matching the pattern the `undici` override right below it already
  documents for the identical failure class. Verified: `pnpm run build-storybook` completes
  successfully again.
- **Tauri HTTP-plugin capability scope pinned (#266).** `http:default` alone grants **no** URL
  scope — every plugin-http call (including AI-SDK cloud calls on desktop) was silently denied by
  the plugin's allow-list check. The capability now explicitly allows loopback any-port
  (`http://localhost:*/*`, `http://127.0.0.1:*/*` — Ollama/LM Studio/vLLM + custom ports) and the
  cloud endpoints mirroring the Tauri CSP `connect-src` (Gemini, OpenAI, x.ai, OpenRouter, Groq).
- **y-webrtc vendor-fork audit + CI invariant guard (#60).** Full-file diff of
  `packages/collab-transport` against upstream `y-webrtc@10.3.0`: no deviations beyond the three
  documented SC patches (PBKDF2 600k iterations, `extractable: false`, `return promise.reject`) plus
  the DataChannel E2E encryption — recorded in `packages/collab-transport/AUDIT.md`, fork bumped to
  `10.3.0-sc2`. The deprecated `patches/y-webrtc@10.3.0.patch` and the dead root `y-webrtc`
  dependency (zero imports) are removed, and the previously-referenced-but-missing
  `scripts/verify-vendor-fork.mjs` now exists and runs in the CI security job (`verify:vendor`).
- **Advisory batch remediated (2026-07-26, CI security gate).** Cargo.lock: `quick-xml` 0.39.4 →
  0.41.0 via `plist` 1.10.0 (RUSTSEC-2026-0194/0195, CVSS 7.5), `anyhow` → 1.0.104,
  `crossbeam-epoch` → 0.9.20, `serde_with` → 3.21.0. pnpm overrides raised: `dompurify` → 3.4.12,
  `protobufjs` → 8.7.1, `body-parser` → 1.20.6 (bounded `<2` for express-4 compat). The two stale
  no-longer-matching OSV ignores (dompurify GHSA-x4vx-rjvf-j5p4, js-yaml-3.x GHSA-h67p-54hq-rp68)
  were dropped from `src-tauri/osv-scanner.toml`. The `pnpm audit` CI step is now advisory
  (`continue-on-error`): some npm CDN edge nodes force-gzip the bulk-advisories response which
  pnpm cannot decode (`ERR_PNPM_AUDIT_BAD_RESPONSE`, deterministic per edge — retries useless);
  the OSV scan of both lockfiles remains the enforced gate.

### Removed

- **Dead `enableWebnnInference` feature flag removed.** The flag shipped default-on but **no runtime
  gate ever read `selectEnableWebnnInference`** — toggling it had no observable effect (a ghost/stub,
  flagged by `audit-feature-parity.ts`). It is removed from the slice, `featureCatalog`, the Settings →
  Experimental UI (now **22 flags / 21 user-toggleable**), the i18n label (19 locales) and the parity
  audit. WebNN execution-provider selection remains available internally in
  `packages/ai-core/src/webnnBridge.ts` (always attempted when the browser exposes WebNN); only the
  no-op user toggle is gone.
- **Dead Settings toggles removed (19 no-op toggles across 6 sections).** A full audit found settings
  that persisted a value **no service or hook ever read**. Removed the whole **Notifications**,
  **Performance**, and **Backup** sections (all no-ops; the real one-click encrypted backup lives in
  Settings → Data, untouched), the dead sync/import card in **Integrations** (Notion/Evernote/Google
  Docs/Scrivener — the **LanguageTool** integration is real and kept), the 4 dead **Collaboration**
  toggles (the **WebRTC signaling URLs** field is real and kept), and Privacy's `crashReporting` /
  `shareUsageData` (analytics/encryption/data-residency stay). Also cleaned `settingsSearchHints.ts`
  (stale hints for the removed categories; retargeted Integrations hints to grammar/spell). Each was a
  stacked PR with its own tests + i18n removal across 19 locales.

## [1.24.0] — 2026-06-21

> **Critical & Immediate hardening sequence** — six stacked PRs (privacy, experimental labeling, coverage, voice consent, local-AI, hygiene/docs) plus the 11→17 locale expansion, shipped as a minor release.

### Security

- **Privacy → Analytics is now a real opt-out (SEC-6).** The Settings → Privacy "Analytics" toggle was cosmetic — only the `enableDuckDbAnalytics` flag controlled persistence. A single enforcement point (`app/analyticsGate.ts` `isAnalyticsPersistenceAllowed`) now gates **every** DuckDB write path (project dual-write, codex, cross-project mirror, RAG vector mirror, seed + RAG migrations, and inference telemetry) on **both** the flag **and** the privacy toggle. The gate is re-evaluated at the last synchronous moment before each async write (no opt-out race); migrations abort without writing their done-marker (so re-opt-in retries) and recover from a transient `error` state; a one-time `analyticsGateMigrated` marker preserves existing-install behavior on upgrade. Analytics remain **local-only metadata** (never manuscript prose, never leaves the device). Full DuckDB OPFS/cell encryption stays deferred to v2.0 (`docs/SECURITY-THREAT-MODEL.md`).
- **Voice consent clarity.** Corrected the misleading "all voice processing runs locally" intro (the default STT path is the cloud Web Speech API) and added a per-engine cloud-vs-on-device privacy note beside the STT engine selector (`settings.voice.engine.privacyNote`, 17 locales).

### Added

- **Device-aware Ollama recommendation + one-click pull.** `pullOllamaModel` streams `POST /api/pull` progress with cancel + error-retry (surfaces Ollama's in-band `{error}` lines, propagates AbortError for cancel, releases the reader on every path); `getOllamaModelForDevice` picks a tiered model (qwen2.5:7b / llama3.2:3b / llama3.2:1b) from the device profile and steps down a size on low battery; new `OllamaDevicePull` settings UI with a recommendation chip + progress/cancel/retry.
- **Reusable `Badge` design-system atom** (variant `experimental | beta | new | neutral`, theme-token driven, accessible) with a Storybook story; applied as maturity badges (driven by `FEATURE_CATALOG`) in the Experimental flags list and an "Experimental" badge in the ProForge dashboard header. New "Limitations, Token Cost & Loop Risks" section in `docs/PROFORGE-PIPELINE.md`.
- **Test coverage for newer subsystems (+101 tests):** collab-transport E2E crypto (the vendored y-webrtc C-1 fork), the ProForge Core Capability Layer + adapters (`proForgeCapabilityCore`, schemas, `agentRegistry`, `nodeInferenceGateway`, `browserProForgeCapability`), and the 5 previously-untested Copilot components (`CopilotPanel`, `CopilotLauncher`, `InlineAnnotationLayer`, `InsightSection`, `HeuristicsModeToggle`).
- **Language expansion — 6 new locales (11 → 17):** Finnish (`fi`), Swedish (`sv`), Hungarian (`hu`), Icelandic (`is`), Basque (`eu`) and Persian/Farsi (`fa`, **RTL**, Arabic script). All ship as Beta. The high-traffic chrome (`portal`, `sidebar`, `dashboard`, top `common.*` verbs) plus native cold-start strings (`i18nBootstrap`) and glossary blocks are hand-translated; the remaining modules were then completed via the glossary-anchored bulk translator (see the bulk-translation entry below). `fa` direction/fonts are automatic via `RTL_LOCALES` + the existing `[dir="rtl"]` Noto Arabic swap — no App/CSS/font changes. New guide: [`docs/LANGUAGE-EXPANSION-2026.md`](docs/LANGUAGE-EXPANSION-2026.md).
- **Bulk-translate hardening (`scripts/bulk-translate-locales.mjs`):** placeholder masking (`{{token}}` → sentinel → restore, so MT can't mangle interpolation) and a `--dry-run` mode (per-file key + glossary-hit counts, no network calls, no writes). The 6 new languages are added to `SUPPORTED_LANGS`, `check-i18n-keys.mjs`, and `build-i18n.mjs`. The `i18nPlaceholders` guard now covers all 17 locale bundles.
- **Localized language picker:** `LanguageSelector` now resolves each language's exonym label (e.g. "Finnish", "Swedish") through `t('portal.language.names.<code>')` at render time instead of a hardcoded string — the native endonym (`Suomi`, `Svenska`, …) stays hardcoded by design so users always find their own language regardless of the active UI locale. Adds `portal.language.names.*` (17 names) to all 17 locales, hand-translated for the 5 core + 6 new languages (other Beta locales' exonyms filled by the bulk translator). `portal` chrome is now fully localized for the 6 new languages.
- **Beta-locale bulk translation (10 languages):** ran the glossary-anchored, placeholder-masked `bulk-translate-locales.mjs` pipeline for `fi/sv/hu/is/eu/fa` (full) and topped up `ja/zh/pt/el`, lifting the 6 new locales from ~8 % to **90-93 %** coverage (machine-translated, **Beta** quality, human native review tracked as follow-up). `help.json` (long-form rich HTML) stays English fallback for the new langs and is excluded from `--all` — its tag-dense markup is not safely machine-translatable. Glossary expanded to **v2.0** (~44 anchor terms/locale: + `Co-Pilot`, `ProForge`, `Subplot`, `Timeline`, `Snapshot`, `Synopsis`, `Mind Map`, `Word Count`, `Continue Writing`, `Improve Writing`, `Consistency Checker`, `Plot Hole`, …). Two bulk-script bugs fixed: `glossaryTranslate` partial-match (→ exact-match only) and `--all` mangling `help.json` HTML (→ excluded).
- **New `docs/TRANSLATION-GUIDE.md`:** end-to-end localization guide — architecture/build flow, placeholder/token rules, tone-by-category, RTL guidelines + per-locale verification checklist, glossary usage, native-review checklist, common pitfalls, and the new-language contribution workflow. `docs/I18N-GLOSSARY.md` updated for the v2.0 anchor set.

### Fixed

- **`enableIdbAtRestEncryption` default drift:** `featureCatalog` declared `defaultOn: false`, contradicting the slice (`true`, the source of truth) — reconciled.
- **README metric drift:** `scripts/sync-readme-metrics.mjs` hard-coded the locale count to `11`, so its regexes stopped matching after the 11→17 expansion and silently froze the i18n key count. Locale count is now dynamic and the regexes match any digit count — README reads the live **17 locales / 2786 keys** with the drift guard green.

### Changed

- **Dependency hygiene + onboarding + docs truth-up:** documented the `joi` accepted-risk override (GHSA-q7cg-457f-vx79; still required via `wait-on`) and the SBOM deferral in `AUDIT.md` (`pnpm audit --audit-level=high` clean); corrected the stale `public/sw.js` "must hand-sync `APP_VERSION`" note in `CLAUDE.md`; added a "Do NOT run heavy suites locally" callout + Minimal Change Checklist to `CONTRIBUTING.md` and mirrored the heavy-suite warning into `.github/copilot-instructions.md`.

- **Docs completion (language-expansion pass):** README i18n badge, language list, capability table and metrics line updated to **17 locales / 2716 keys**; Persian added to the RTL-Beta section; `AUDIT.md` follow-up chain + quality-gate entry for 2026-06-17.


## [1.23.1] — 2026-06-17

### Fixed

- **Tauri desktop app stuck on "WorldScript Studio ist offline."**: the PWA Service Worker was registering inside the Tauri WebView (WebView2 supports SWs) and hijacking the root navigation. When its versioned caches were empty (precache fails under the `tauri.localhost` custom protocol while a version bump had already pruned the previous caches), the SW's network-first navigation strategy fell through to the hardcoded inline offline fallback (`public/sw.js`), rendering a bare "<APP> ist offline." page instead of the app. A Service Worker has no place in Tauri — the desktop app is already served locally and offline-first. Two-layer fix: (1) `register-sw.ts` now detects the Tauri runtime and never registers, additionally unregistering any SW + deleting `worldscript-*` caches so already-broken installs self-heal; (2) `public/sw.js` detects the Tauri origin (`tauri://` / `tauri.localhost`) and becomes a no-op — it precaches nothing, never intercepts `fetch`, and self-unregisters on `activate`. The browser PWA path is unchanged.

## [1.23.0] — 2026-06-16

### Changed

- **v1.23 P0 tracker reconciliation (docs):** `ROADMAP.md`, `TODO.md`, and `AUDIT.md` brought into agreement after a drift where ROADMAP marked all v1.23 P0 items done while TODO still listed three as open. Each item is now evidence-backed (audit output, CI run, file existence). The manual smoke-test *run* is split out as a tracked human-only step (the protocol document itself is complete).
- **AUDIT.md Known Overrides table refreshed:** added the just-merged `esbuild >=0.28.1` override (GHSA-67mh-4wv8-2f99, dev-server CORS), replaced placeholder advisory strings with verified GitHub Advisory IDs (re-checked 2026-06-13), and labelled preventive-only pins honestly. Dependency hygiene re-verified: `pnpm audit` high **and** moderate → 0 vulnerabilities.
- **Dependency maintenance (Dependabot):** bumped `@ai-sdk/openai`, `@ai-sdk/google`, `yjs`, `tailwindcss`, `turbo`, `lint-staged`, and the `log` crate to current patch/minor releases (web CI green on each).

### Added

- **Plugin sandbox adversarial test coverage:** `tests/unit/workers/plugin.worker.test.ts` gains WebAssembly-denial, `GeneratorFunction`/`AsyncGeneratorFunction` constructor-escape, and guard-restoration (success + error path) tests for the v1.22 plugin-isolation hardening. New living audit artifact `docs/AUDIT-PERFECTION-PLAN-v1.23.md` tracks the 6-phase perfection engagement and its follow-ups.
- **AI error taxonomy (`services/ai/aiErrorTaxonomy.ts`):** pure `classifyAiError(err)` → `{ category, retryable, messageKey }` across transient / rateLimit / auth / network / offline / policy / invalidRequest / canceled / permanent (cancellations via `AbortError` fail fast — never retried). Consumed by the retry layer.
- **Actionable AI error messages in the Copilot:** when an AI call fails, the Copilot now shows a localized, recovery-oriented message (e.g. "Invalid or missing API key — open Settings → AI & Models to add or update it.") instead of a generic "Something went wrong". Maps each taxonomy category to a new `error.ai.*` key (9 keys × 11 locales; translated in de/en/es/fr/it, English fallback in Beta/RTL) via a reusable `getAiErrorMessage(err, t)` helper.
- **AI request correlation IDs:** each AI generation now gets one opaque correlation id (`newCorrelationId`, `services/logger.ts`) shared by the request-start log (`useWorldScriptAI`), the fetch-side failure log (`worldScriptCompletionFetch`, propagated via the request body), and the retry seam (`withTransientRetry`) — for end-to-end traceability. No prompts or keys are logged.
- **Rebrand to WorldScript Studio:** rename StoryCraft Studio → WorldScript Studio across user-facing code, assets, PWA manifest, Tauri config, i18n (11 locales), docs, and CI/CD. New identifiers: `worldscript-studio` package, `com.worldscript.studio` Tauri identifier, `/WorldScript-Studio/` GitHub Pages base, `worldscript://` deep-link scheme, `.worldscript`/`.wsst` file associations. PWA service-worker cache names bumped to `worldscript-*` v1.23.0 to invalidate stale caches. Feature-Flags localStorage key, IndexedDB database names, and accessibility CSS class tokens all renamed to `worldscript-*`. This is a pre-release rebrand with no existing installs, so no storage migration is required (the `storycraft-driver-popover` onboarding-tour token is the one intentionally unchanged token, as its class usage was not renamed).
- **Test coverage — Tauri filesystem backend (Phase 2):** `services/fs/` (the desktop FS storage chain — project/snapshot/asset/settings/codex stores + `fsCore`) went from **0% to ~81% line / ~66% branch** coverage via an in-memory fake-`TauriApis` harness that drives real round-trips (LZ-String compression, AES-GCM API-key encryption, JSON, import/export). 37 new tests (`tests/unit/services/fs/`).
- **Local-first data model foundation (behind `enableLocalFirstSync`, off by default):** a perf baseline harness (`pnpm bench`, A0.1), a Y.Doc proof-of-concept (`services/localFirst/projectDoc.ts`, B0.1), and an incremental write-through doc binding + debounced shadow-sync (`docBinding.ts` / `docPersistence.ts`, B1.1) that keeps a Yjs shadow in lockstep with Redux without affecting users — Redux stays the source of truth during the shadow phase. ADR-0008. (#140)

### Fixed

- **Desktop app no longer launches to a blank window:** the Tauri build resolved Vite's `base` from `TAURI_PLATFORM` — the Tauri **1.x** env var, which Tauri 2.x never sets — so every desktop build fell through to the GitHub Pages base (`/WorldScript-Studio/`) and 404'd its hashed assets under `tauri://localhost/`, leaving only the native file/help menu over an empty webview (Windows/macOS). Base resolution now checks `TAURI_ENV_PLATFORM` (legacy name kept as a fallback) and is extracted into a unit-tested `config/resolveViteBase.ts` so the regression can't return. Note: the Linux `.deb`/AppImage require `webkit2gtk-4.1` (Ubuntu 22.04+) — a Tauri 2 platform minimum, not a bug.
- **AI retry no longer backs off doomed calls:** `withTransientRetry` now classifies the error and **fails fast** on non-retryable categories (invalid API key, policy block, malformed request, offline) instead of retrying with exponential backoff. Transient / rate-limit / network errors still retry (honoring `Retry-After`). Each retry decision emits a structured `ai.retry` log line with a per-call correlation id (no payloads or keys). A `shouldRetry` option allows callers to override the default.
- **Plugin worker no longer leaks a sandbox guard across runs (FU-1):** `workers/plugin.worker.ts` restored `Function.prototype.constructor` through the bare `Function` identifier, which install had reassigned to the denied stub — so the real constructor stayed neutered after a plugin run. Restoration now routes through the module-captured native `Function`, keeping the dedicated worker's global scope clean between tasks. Restoration is also hardened: the `self.*` bindings are restored first and unconditionally, and each constructor is force-redefined via `Object.defineProperty` (best-effort), so a plugin that locks a property descriptor cannot abort the restore and poison subsequent runs. Isolation during execution is unchanged.
- **Command Palette fully localized:** ~20 command labels and category headers (AI Execution Modes, editor modes, appearance presets, accessibility toggles, Navigation/Editor/Global/etc.) were showing English in de/es/fr/it because the keys existed but the values were never translated. All are now translated for the core locales (de/en/es/fr/it). A new guard test (`tests/unit/i18n/paletteLocalization.test.ts`) fails if any `palette.*` key reverts to English fallback in a core locale (with a small allowlist for loanwords). Beta/RTL locales remain English-fallback by policy.
- **Writer shows localized, classified AI errors:** the Writer's generation-failure handler dispatched a hardcoded English string ("Error generating content…") and a hardcoded `[Cancelled]` tag. It now uses `getAiErrorMessage(err, t)` (same actionable, localized messages as the Copilot) and a localized `writer.cancelledTag`.
- **OpenRouter cloud-policy block is now reactive:** the OpenRouter settings panel derives its blocked state from live Redux (`aiMode` + `privacy.localStorageOnly`) instead of a one-shot async check, so toggling *Local storage only* or switching the AI mode updates the banner and the test-connection / catalog-fetch guards instantly. Split into distinct `policyBlocked.mode` / `policyBlocked.localOnly` messages (translated across the 8 non-stub locales) and fixed an infinite render-loop in the policy-blocked catalog path. (#163)
- **Local AI settings localized:** the 40 English-only `settings.ai.localAi.*` keys (WebGPU capability, model downloads, storage usage, fallback chain, throughput) translated for de/es/fr/it/el/ja/pt/zh (ar/he stay English stubs; model names unchanged). (#164)
- **Real WorldScript app icons:** replaced the placeholder icons — generic 16-bit RGBA PNGs that broke the macOS/Windows Tauri bundler (`unsupported ColorType: Rgba16`) and blocked the desktop release — with a new "W" quill-nib monogram, regenerated as 8-bit across `favicon.svg`, the PWA icons, and the full Tauri icon set (incl. a newly generated `icon.icns`). Also fixed remaining StoryCraft URLs in `robots.txt` / `sitemap.xml` / `_redirects` / `CNAME.example` and renamed the Cloudflare Pages project in `wrangler.toml`. (#165)

## [1.22.0] — 2026-06-11

### Added

- **OpenRouter provider (Cloud 5):** Unified gateway to 100+ open-source models. `services/ai/providers/openrouterProvider.ts` — circuit breaker (4 × 429 → 5 min pause), RPM tracking, free-tier catalog (`deepseek/deepseek-r1:free`, `meta-llama/llama-3.3-70b-instruct:free`, `qwen/qwen2.5-72b-instruct:free`, `google/gemma-3-27b-it:free`, `mistralai/mistral-7b-instruct:free`). Settings → OpenRouter panel with enable toggle, API key (AES-encrypted), model selector. Sign up at openrouter.ai/keys — no credit card for `:free` models.

- **AI Execution Modes:** `AiMode = 'hybrid' | 'cloud' | 'local' | 'eco'` — four routing strategies exposed in **Settings → AI & Models → AI Execution Mode**:
  - **Hybrid** (default): local models when preloaded → cloud fallback
  - **Cloud**: all requests to configured cloud provider
  - **Local**: on-device only via Ollama / WebLLM / ONNX — nothing leaves the device
  - **Eco**: battery-saving tiny 0.5B model + heuristics only; no cloud, no GPU
  `aiModeService.ts` persists the active mode to `settings.aiMode`; `listenerMiddleware` syncs without page reload. `AiModeIndicator` chip in the Copilot header shows the active mode and turns amber when the OpenRouter circuit breaker is open.

- **Ultimate Copilot AI v2 — Phase 2+3 (PR #110, #111):**
  - **Markdown rendering** in `CopilotMessageList` — assistant messages rendered as sanitised HTML (DOMPurify + inline micro-markdown renderer; headings, bold, italic, code blocks, lists). No new runtime dependency.
  - **Sidebar/dialog mode toggle** — panel can be docked to the right edge on desktop (≥ 768 px); preference persisted in `localStorage`. Mobile always uses dialog mode.
  - **Apply-to-chapter** — "Apply to chapter" button on the last assistant code block rewrites the active manuscript chapter via `applyTextEdit` (offset-safe, dispatched into redux-undo for Ctrl+Z reversal). Gated to blocks ≥ 70 % of section length to prevent partial-snippet overwrites.
  - **InlineAnnotationLayer** — absolute-positioned badge inside `ManuscriptEditor` showing the heuristic-insight count for the active chapter. Clicking opens the Copilot and auto-expands the Insights section.
  - **ProForge "Ask Copilot" chip** — each `ReviewItemCard` in the ProForge Review Panel shows an ✦ Ask Copilot button (gated by `enableGlobalCopilot`) that pre-fills the Copilot composer with the item's context.
  - **`docs/COPILOT.md`** — user-facing feature guide (architecture, modes, Apply-to-chapter, ProForge integration).
  - **`docs/HEURISTIC-RULES.md`** — per-rule reference (8 rules, how-to-satisfy, i18n key pointers).
  - **2 new E2E tests** — heuristics-only toggle and sidebar mode toggle in `copilot-flags.spec.ts`.

- **WebLLM worker offload (P1-1, ADR-0005):** `@mlc-ai/web-llm` (WebGPU) inference now runs in a
  dedicated WorkerBus v2 `webllm` pool (`workers/v2/webllm.worker.ts`, capability `inference.webllm`)
  instead of inline on the main thread. Worker-first with an automatic main-thread fallback on
  `NO_WEBGPU` / worker-spawn failure / circuit-open, decoupled from `enableWorkerBusV2`. GPU mutex +
  tab-leader election stay on the main thread; loading progress bridges to `inferenceProgressEmitter`
  so the UX is unchanged.
- **Whisper WASM STT end-to-end tests (P1-2):** A deterministic, deep-E2E suite
  (`tests/e2e/deep/voice/whisper-stt.spec.ts`) exercises the full voice orchestration — simulated
  model download (progress / cancel / error → retry), STT → intent → command-dispatch navigation, and
  stop-listening stability — via a guarded test seam (`services/voice/voiceTestSeam.ts`). A
  non-blocking nightly workflow (`voice-nightly.yml`) runs the **real** Whisper download + pipeline
  init against the live CDN.

### Changed

- **Voice hardening (v1.21 follow-up):** Transcript redacted from the intent-engine debug log
  (C-P0 — user speech is PII and the IDB log sink persists it); single-flight guard on
  `VoiceCommandService.startListening` against re-entrant push-to-talk / wake-word starts; download
  modal progress is now an accessible `role="progressbar"` with a polite live region (`Progress`
  atom + `VoiceModelDownloadModal`).
- **i18n:** 2 594 keys × 11 locales (+62 keys for AI Execution Modes, OpenRouter settings, Copilot v2 actions).

### Fixed

- **Prompt injection & plugin isolation hardening (PR #114):**
  - `services/proForge/applyReviewEdits.ts` now rejects C0 control characters (except `\t`, `\n`, `\r`), null bytes, and lone surrogates in AI-proposed edits; invalid items are skipped individually instead of aborting the whole batch.
  - `services/copilot/actionApplier.ts` whole-section replacement on empty chapters now works by passing an explicit full-range edit.
  - `services/pluginRegistry.ts` enforces stricter storage-key validation: maximum length, allowed suffix characters, anti-traversal (`..`), and a 2 MiB serialized value size cap.
  - `components/copilot/CopilotMessageList.tsx` DOMPurify config hardened with `ALLOW_DATA_ATTR: false`, `FORBID_ATTR: ['style']`, and `SANITIZE_DOM: true`.
- **PWA blank screen on update:** SW `APP_VERSION` bumped `1.20.0 → 1.21.2` so the activate handler correctly prunes the stale `storycraft-static-v1.20.0` cache after deployment.

---

## [1.21.0] — 2026-06-10

### Added

- **Sepia dark mode — "Candlelit Manuscript" variant:** New warm low-light theme variant joining the light/dark/sepia families; body-class themed via `--sc-*` tokens (no `dark:` prefix). (`1321478`)
- **Deep E2E coverage layer:** Non-blocking `e2e-deep` job — feature-flag matrix (`tests/e2e/deep/feature-flag-matrix.spec.ts`) parametrized across `test-matrix.ts`, plus error-path specs (offline AI, rapid nav, all-flags-on). Explicit per-flag specs seed state via `setFeatureFlags()`. (`663ca2f`)
- **Chinese (zh) locale + pt/el Beta translation batches:** zh Simplified brought under the 5% English-placeholder target; pt/el Beta translation batches landed. (`364025e`, `e8cddcb`)
- **Whisper WASM STT download UI + VAD→Whisper bridge:** `VoiceModelDownloadModal` ships; `VoiceActivityCoordinator` wires `WebRtcVadEngine` PCM frames into `WasmSttEngine` (MIN_SPEECH_CHUNKS gate + MAX_BUFFER_MS flush) behind `enableVoiceWasm`. (`e8cddcb`, `364025e`)

### Changed

- **CSP connect-src — documented BYOK tradeoff (ADR-0004):** Explicit cloud-provider endpoints in `index.html` `connect-src` removed as redundant; the intentional `https:` scheme-source (required by the shipped `openAiCompatibleBaseUrl` BYOK feature) is retained and documented. Tauri CSP stays strict (no `https:` blanket). Regression test in `tests/unit/csp.test.ts`.
- **Coverage batches A–C:** Incremental unit-test coverage additions; thresholds held at lines 74 / functions 67 / branches 60 / statements 72. (`364025e`)
- **Dependency bumps:** `@huggingface/transformers` 3.8.1 → 4.2.0 — **major bump verified (WS-3)**: the APIs ai-core/voice consume are unchanged in v4.2.0 (`pipeline(task, model, { dtype, device })`, `env.backends.onnx.wasm.proxy`, `RawAudio`/`read_audio` exports); `pnpm typecheck` clean and 63 ai-core/voice integration tests green; no source changes required. Production bundling (rolldown tree-shaking / `vendor-ai-onnx` chunk) is exercised by the CI `build` + `smoke:prod` jobs. Also `@biomejs/biome` → 2.4.16, `@mlc-ai/web-llm` → 0.2.84, `vite` → 8.0.16, `@google/genai` → 2.8.0, `@tanstack/react-virtual` → 3.14.2.

### Fixed

- **Command palette footer contrast (a11y):** `text-muted` → `text-secondary` for WCAG 2.2 AA contrast. (`672e56d`)
- **Voice settings tab + auto-save false-positive + help locale cleanup.** (`e049f08`)
- **E2E / CI stabilization:** viewport-aware nav locators, ProForge empty-state visibility on Desktop Chrome, Voice WASM section, Early-Access hyphenated German label, and 17 unit-test fixes across SettingsView/HelpView/VoiceSettingsSection. (`43602c2`, `f16ba42`, `3cf9387`, `fe598ed`, `d73397e`)

### Docs

- **Integrity & hardening cycle (v1.21, audit F-1…F-9):** README badge → released v1.20.0 + refreshed metrics (433 test files / 2 357 i18n keys); 28 misfiled v1.19-era CHANGELOG entries migrated to `[1.19.0]`; TODO sprint rollover. ADR-0004 (CSP/BYOK). New suppression-count ratchet gate (`scripts/check-suppressions.mjs`, wired into CI `quality`) + first abatement tranche — 22 `noExplicitAny` suppressions removed, baseline ratcheted 181 → 159. Bundle-budget single source of truth (`bundle:budget` = `--max-kb 6500 --max-entry-kb 4000`, script defaults aligned). Governance docs: `VENDOR-FORKS.md` gains a CVE/OSV-coverage section (the vendored y-webrtc source is invisible to OSV — manual upstream-advisory process documented), new `docs/COVERAGE-POLICY.md` (threshold ratchet rule).

---

## [1.20.0] — 2026-06-07

### Added

- **UI Modernization Phase 1 — LanguageSelector, RadioGroup, Tabs**:
  - `LanguageSelector.tsx` — Modern combobox with search functionality, flag emojis, RTL support, and reduced-motion awareness. Replaces inline language buttons in WelcomePortal with a searchable dropdown.
  - `RadioGroup.tsx` — Accessible radio group component with proper ARIA attributes (`role="radiogroup"`), individual option descriptions, and glassmorphism styling.
  - `Tabs.tsx` — WAI-ARIA compliant tabs component with three variants: `default`, `pills`, and `underline`. Includes `TabPanel` component for content association.
  - `SettingsShared.tsx` — ToggleSwitch optimized for RTL layouts with reduced-motion support.
  - `docs/UI-MODERNIZATION.md` — Comprehensive guide for UI component usage, migration patterns, and design principles.
- **Phase 3 i18n Expansion — ja/zh/pt/el Beta languages + Intl APIs**:
  - Added Japanese (ja), Chinese Simplified (zh), Portuguese (pt), and Greek (el) as Beta languages with English placeholder text
  - Extended `Language` type and `VALID_LANGS` array in `I18nContext.tsx`
  - Added `SUPPORTED_LOCALES` metadata array with BCP47 codes, native names, direction, and font script hints
  - Integrated native Intl APIs with caching: `Intl.PluralRules`, `Intl.NumberFormat`, `Intl.RelativeTimeFormat`, `Intl.Collator`, `Intl.ListFormat`, `Intl.DisplayNames`
  - Added `getPluralCategory()`, `formatNumber()`, `formatRelativeTime()`, `getCollator()`, `formatList()`, `formatDisplayName()` to `I18nContextType`
  - Auto-formatting of `{{count}}` placeholders in `t()` function
  - Fonts: Noto Sans JP via Google Fonts CDN for Japanese/Chinese; Greek uses system fallback
  - CSP updated to allow fonts.googleapis.com and fonts.gstatic.com
  - Documentation: `docs/I18N-PLURALS.md`, `docs/I18N-NUMBERS.md`, `docs/I18N-LOCALE.md`, `docs/I18N-RELATIVETIME.md`, `docs/I18N-COLLATION.md`, `docs/I18N-LISTFORMAT.md`, `docs/I18N-DISPLAYNAMES.md`, `docs/I18N-GLOSSARY.md`
  - 2339 keys × 11 locales (up from 2259 × 7)
  - 53 unit tests covering all Intl APIs

### Fixed

- **World Building "Add Manually" now opens the atlas editor** (2026-06-03): `useWorldView.handleAddNewManually` only dispatched `addWorld` and left the user on the grid with a silent "New World" card and no editor — inconsistent with Characters, whose manual-add was deliberately fixed to open the dossier. Now mirrors that flow (create → select → open atlas) with fully-formed defaults (`timeline`/`locations` as `[]`). Adds real-browser `tests/e2e/world.spec.ts` (was none) + a hook-level regression assertion.
- **CI unblock — OSV `paste` advisory + Vercel rate-limit noise** (2026-06-03):
  - `src-tauri/osv-scanner.toml` — ignore `RUSTSEC-2024-0436` (`paste` 1.0.15 *unmaintained*; build-time proc-macro helper, no runtime exposure, no fix release). The advisory was newly published and was failing the required **Security Audit** check on every branch (e.g. Dependabot PR #78).
  - `vercel.json` — `"github": { "silent": true }` so Vercel still deploys but no longer posts commit statuses; the free-tier **"Deployment rate limited — retry in 24 hours"** preview failure can no longer show as a hard fail on PRs. (Vercel was never a *required* status check, so this is purely cosmetic-noise removal.)

### Added

- **Tauri Desktop Pipeline — P0-1 complete** (2026-06-06):
  - `pnpm-workspace.yaml` migration — moved `overrides`, `peerDependencyRules`, `onlyBuiltDependencies`, `patchedDependencies`, `ignoredBuiltDependencies`, and `allowBuilds` from deprecated `package.json` `"pnpm"` field to `pnpm-workspace.yaml`; resolves `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` on CI
  - `tauri-build.yml` — `shell: bash` for Windows compatibility; skips `TAURI_SIGNING_PRIVATE_KEY` for `workflow_dispatch` test builds; `jq`-disables `createUpdaterArtifacts` when no signing key is available (prevents "public key found, but no private key" error)
  - macOS: removed invalid `exceptionDomain` object and `signingIdentity: "-"` from bundle config; added `Entitlements.plist` with hardened-runtime permissions
  - Release profile hardening: `lto = true`, `codegen-units = 1`, `strip = true`, `panic = "abort"`
  - Bundle metadata: `category`, `publisher`, `copyright`, `shortDescription`, `longDescription`
  - Verified: ubuntu-22.04 (deb, rpm, AppImage), windows-latest (MSI), macos-latest (DMG) all build successfully

- **Coverage C-7 — 96 new unit tests** (2026-06-06):
  - `tests/unit/loraDatasetBuilder.test.ts` (19) — scene pair extraction, quality scoring, synthetic generation, JSONL export (Alpaca/ChatML/ShareGPT), quality report estimation
  - `tests/unit/loraEvaluationService.test.ts` (16) — cosine similarity, mean similarity, style consistency scoring, score labels, prompt output comparison
  - `tests/unit/intentEngine.test.ts` (17) — exact template matching, fuzzy Jaccard scoring, navigation slot extraction, view context filtering, command replacement
  - `tests/unit/feedbackService.test.ts` (23) — TTS queue processing, feedback level filtering (minimal/standard/verbose), mute behavior, event emission, confirm/error/info helpers
  - `tests/unit/audioNavigator.test.ts` (21) — ARIA landmark scanning (main/nav/aside/region/search), focus cycling, `tabindex` management, live region announcements with priority switching

### Security

- **Accidentally committed signing keys removed** (2026-06-06): `~/.storycraft-tauri.key` and `~/.storycraft-tauri.key.pub` were committed in `da7653b`; rotated in GitHub Secrets, files removed, `.gitignore` hardened with `*.key`, `*.pem`, `*.p12`, `*.pfx`, `*.cer`, `*.der`, `*.sig.key`
- **aiohttp CVE remediation** (2026-06-06): bumped `aiohttp==3.11.16` → `3.14.0` in `scripts/ci-analyzer/requirements.txt`; resolves 21 Dependabot CVEs (GHSA-...)

## [1.19.0] — 2026-05-28

### Added

- **B-1 — IDB At-Rest Encryption** (`services/storage/storageEncryptionService.ts`): Full AES-256-GCM passphrase-derived encryption for IndexedDB stores. PBKDF2 (600 000 iterations, SHA-256, 32-byte random salt stored in `app-data` as `idb_kdf_salt_v1`). `CryptoKey` is `{ extractable: false }`. Feature-flagged behind `enableIdbAtRestEncryption` (off by default). Tauri build uses `tauri-plugin-stronghold` for OS-keychain-backed passphrase (zero user friction). Web build shows passphrase unlock modal on cold start (session-scoped in-memory key wiped on tab close). GDPR threat model: encrypted blobs unreadable without passphrase from browser profile or malicious extension. Storage decomposition in `services/storage/` (`idbCore`, `idbProjectStore`, `idbSnapshotStore`, `idbKeyStore`, `idbCodexStore`, `idbAssetStore`).

- **B-2 — Voice WASM Engine Scaffold** (`services/voice/wasmSttEngine.ts`, `services/voice/sileroVadEngine.ts`): Whisper.cpp WASM STT engine interface scaffold (model download, chunked inference, 99+ language detection). Silero VAD v4 via ONNX Runtime Web (~2 MB model, lazy-loaded). Both implement the existing abstract `SttEngine` / `VadEngine` interfaces from `voiceTypes.ts`. Feature-flagged behind `enableVoiceWasm` (off by default); falls back to `WebSpeechSttEngine` / `WebRtcVadEngine` when off.

- **B-3 — collab-transport Vendor Fork** (`packages/collab-transport`): Vendor fork of y-webrtc 10.3.0 with RTCDataChannel in-flight E2E encryption baked into the package source. Replaces the pnpm-patch approach (`patches/y-webrtc@10.3.0.patch`). All Yjs sync updates and awareness protocol messages over peer-to-peer WebRTC data channels are encrypted via AES-256-GCM using `room.key`. Workspace package consumed as `workspace:*`.

- **B-4 — axe-core E2E Accessibility Gate** (`tests/e2e/a11y-axe.spec.ts`): 8-view axe-core WCAG 2.2 AA Playwright scan run in CI on every push. Views covered: Dashboard, Writer, SceneBoard, Characters, Worlds, BookPreview, ProgressTracker, Settings. Zero violations enforced (`expect(violations).toHaveLength(0)`); known non-blocking notices logged but not failed.

- **B-5 — RTL Layout Beta**: Arabic (`ar`) and Hebrew (`he`) locale stub files added to `locales/`. `enableRtlLayout` feature flag activates `html[dir="rtl"]` and a BiDi context provider for bidirectional text layout. Full RTL translation content and Persian (`fa`) support are v2.0 milestones. Existing `enableRtlLayout` flag wired to `html[dir]` control in `App.tsx`.

- **B-6 — StructuredLogger** (`services/logger.ts` rewrite): Ring-buffer replaced with a multi-sink structured logger:
  - **IDB sink** — `storycraft-logs-db` / `logs` store, 1 000-entry LRU cap, auto-eviction via forward cursor.
  - **Tauri JSONL sink** — `$APPDATA/logs/storycraft-YYYY-MM-DD.jsonl`, lazy-loaded Tauri FS modules, date-rotated, `{ append: true, create: true }`.
  - **Console sink** — DEV-only, prefixed `[StoryCraft:LEVEL:module]`.
  - **GDPR sanitization** — `sanitizeLogContext(ctx)` redacts values whose key matches `/key|token|password|passphrase/i`.
  - **New API** — `createLogger(module): ModuleLogger` factory with `.debug()/.info()/.warn()/.error()` and `.withContext(ctx)` for structured context injection. Default `logger` export and `getRecentLogs()` / `formatLogsForReport()` / `clearLogs()` retained for backward compatibility.

- **B-7 — Coverage Thresholds Raised**: Vitest gate: Lines ≥ 71 / Functions ≥ 63 / Branches ≥ 57 / Statements ≥ 69. Measured: 73.06% L / 65.18% F / 58.79% B / 71.29% S — all green.

- **B-8 — Stryker Gate Raised**: `thresholds.break` raised 70 → 75. `mutate` targets expanded from 34 → 40 source files to cover new services introduced in B-1..B-6.

- **Sequential shell execution rule** codified in all 4 instruction files (`CLAUDE.md` project root, `.github/copilot-instructions.md`, `.cursorrules`, `infra/low-end-ci/DAILY-DRIVER.md`) — ONE Bash call per response, no parallel shell calls on this 3.7 GB RAM hardware.

- **WebGPU detector service (2026-05-18):** New `services/ai/webGpuDetectorService.ts` — `detectWebGpuDetails()` queries `navigator.gpu.requestAdapter()`, reads `adapter.limits.maxBufferSize` for VRAM tier heuristic (≥8 GB = high, ≥4 GB = medium, else low). AiProviderCard gains live GPU status badge, WebLLM model dropdown, and ONNX model dropdown. `LOCAL_INFERENCE_PROVIDERS` + `isLocalInferenceProvider()` added to `orchestrationProviders.ts`. 12 new settings i18n keys across all 5 locales (1408 → 1414 total).

- **ONNX Runtime Web Layer-2 in ai-core (2026-05-18):** `packages/ai-core/src/index.ts` adds an ONNX WASM fallback layer between WebLLM and Transformers.js. `LocalAiLayer` type includes `'onnx'`. `ONNX_SUPPORTED_MODELS` exported. `vite.config.ts` gains `vendor-ai-onnx` manual chunk to keep onnxruntime-web + @xenova/transformers under Workbox's 8 MiB SW cache limit.

- **Yjs AES-256-GCM encryption foundation (2026-05-18):** `collaborationService.ts` gains `encryptUpdate()`, `decryptUpdate()`, `deriveEncryptionKey()` (PBKDF2 600 000 iterations, SHA-256, AES-256-GCM), and `getEncryptionStatus()` (`'encrypted' | 'psk-only' | 'plaintext'`). `CollaborationPanel.tsx` shows green/amber encryption status badge post-connect. 3 new collab i18n keys.

- **Tauri v2 auto-updater pipeline (2026-05-18):** `tauri-build.yml` gains a `Generate latest.json` step that builds the Tauri v2 update manifest from signed `.sig` files and uploads it to GitHub Release. `docs/TAURI-UPDATER.md` extended with a full GitHub Secrets table. `docs/TAURI-CI.md` gains a 7-step first-release checklist.

- **Cross-Project-Search v2 (2026-05-18):** DB_VERSION 7→8 with new `projects-index-store`. New `crossProjectIndexService.ts` — `indexProject()`, `listIndexedProjects()`, `removeProjectIndex()` (privacy-preserving: no manuscript plaintext). `searchAcrossProjectIndex()` added to `crossProjectSearchService.ts`. `CrossProjectSearchPanel.tsx` runs two-phase search (index first, then current project). 3 new `crossSearch.*` i18n keys (1414 total).

- **Mobile-aware E2E helpers (2026-05-17):** `clickNavItem(page, name)` in `tests/e2e/helpers.ts` — tries desktop `#sidebar` (hidden md:flex), then mobile bottom-tab-bar (`[data-tour="nav-mobile"]`), then the "More" sheet; eliminates all `sidebar(page)` calls that fail on Pixel 5 viewport. `selectFirstEnabledWriterSection` now switches to the context tab on mobile before locating the section selector.

- **ARIA tablist on WriterView mobile segmented control:** Each tab button gains `role="tab"`, `aria-selected`, `aria-controls`, `data-testid="writer-tab-{context|tools|result}"`; container gains `role="tablist"`; panel divs gain `role="tabpanel"` + `aria-labelledby` — axe-compliant and stably selectable in Playwright.

- **Mobile VC button in WriterViewUI:** `md:hidden` version of the version-control toggle button with `data-testid="writer-version-control-btn"` and `aria-expanded` — mirrors the desktop button that is hidden on Pixel 5 viewport.

- **Stable test anchors:** `data-testid="snapshot-label-input"` on the snapshot-label `<Input>` in `VersionControlPanel.tsx`; `data-testid="export-preview"` on the `<pre>` export preview in `ExportView.tsx`.

- **OSV vulnerability scan in CI security job:** `google/osv-scanner-action@v2` step wired after `pnpm audit` — `osv-scanner.toml` existed but was never executed; advisories now caught on every push/PR.

- **JUnit E2E artifact:** Playwright JUnit reporter output (`tests/e2e/results/junit.xml`) uploaded as `e2e-junit` artifact — enables per-test check annotations on GitHub PRs.

### Changed

- `services/logger.ts` — backward-compat `logger` export, `getRecentLogs()`, `formatLogsForReport()`, and `clearLogs()` retained; in-memory cache kept at 200 entries as fast path for `formatLogsForReport`.
- `packages/collab-transport` replaces pnpm-patched `y-webrtc` dependency; `patchedDependencies` entry removed from `package.json`.

- **i18n Comprehensive Sweep (2026-05-18):** All remaining hardcoded user-facing strings eliminated across 5 locales — **1 440 keys** total (up from 1 414). Fixes include: `help.tryTour` (was rendering raw key `"try.Help"` in the command palette), `initialProject.chapter1` (`"Chapter 1"` in projectSlice + AdvancedImportExport — extended `resetProject` payload with optional `chapter1Title`), `manuscript.resizer.left/right` (hardcoded German string `"Linkes Panel anpassen"` remained in source), `writer.stopGenerating / tools.selectLabel / versionControl.tooltip`, `settings.ai.temperature.precise/balanced/creative`, `export.pasteSection.heading` (`"Google Docs / Notion"`), `outline.result.body`, `characters.uploadImage / editorTabsAriaLabel`, `worlds.uploadImage / editorTabsAriaLabel`, `templates.tabs.myTemplates / community`, `error.boundary.title/description/reset/reload/report`, `manuscript.spellcheck.didYouMean/applyFix`, `manuscript.grammar.checkButton`, `manuscript.zenMode.enter/exit/label`, and `writer.studio.controls.custom/customTonePlaceholder`.

- **ErrorBoundary fully localized (2026-05-18):** `components/ui/ErrorBoundary.tsx` refactored with inner `ErrorFallback` functional component — accesses `useTranslation()` hook to render title, description, and all buttons (Reset View, Reload Page, Report issue) in the active locale. Import path corrected to `hooks/useTranslation`; `onReset` passed conditionally to satisfy `exactOptionalPropertyTypes`.

- **Unit-test coverage — 1 641 tests / 150 test files (2026-05-18):** Measured **62.86 % statements · 49.06 % branches · 54.10 % functions · 64.68 % lines**. Vitest thresholds at statements 53 / branches 37 / functions 50 / lines 55 — all passing.

- **Unit-test coverage — Phase 4.5 thresholds met (2026-05-17):** Measured **63.32 % lines · 61.5 % statements · 47.1 % branches · 53.2 % functions** (1 561 tests). Vitest thresholds at lines 55 / statements 53 / branches 37 / functions 50.

- **Stryker mutation gate enforced:** `thresholds.break` raised `null` → `30`; `timeoutMS` lowered 180 000 → 120 000 ms; CI mutation job `continue-on-error` → `false`, `timeout-minutes: 20` → `30`.

- **Lighthouse performance promoted to error:** `categories:performance` `warn:0.5` → `error:0.4`; `categories:seo` added as `warn:0.8`; FCP tightened 6 000 → 5 000 ms; LCP tightened 8 000 → 7 000 ms.

- **CI concurrency fix:** `cancel-in-progress` restricted to PRs only — main-branch deploys no longer cancelled by a concurrent push.

- **Artifact retention aligned:** `dist` 7 → 3 days; `lighthouse-report` and `storybook` 14 → 7 days.

- **Unit-test coverage — Phase 1 thresholds met:** 17 new test files added (733 tests total); Vitest coverage thresholds bumped to `{ lines: 35, functions: 30, branches: 22, statements: 33 }` (previously 25/21/17/24). Measured coverage: **36.47 % lines · 35.53 % statements · 24.96 % branches · 30.22 % functions** — all Phase 1 targets exceeded. New files cover: `commands/` (fuzzyScore, palettePreferences, commandSystem), project thunks (writing, character, binder, management), hooks (useDashboard, useManuscriptView, useGlobalKeyboardShortcuts, useCharacterView, useOutlineGenerator), `aiProviderService` fallback chain, `dbService` snapshots, `dbService` binder assets, and `crossProjectSearchService`.

- **Stryker mutation targets expanded (Phase 4):** `stryker.conf.json` `mutate` array now includes `services/commands/fuzzyScore.ts`, `services/commands/palettePreferences.ts`, and `services/commands/commandBuilder.ts` in addition to the existing `codexService.ts` and `dbMigration.ts`.

### Fixed

- **TypeScript 6 strict hardening (2026-05-18):** `'grok-3'` and `'grok-3-mini'` added to `AiModel` union in `types.ts` (TS2322 in `aiProviderService.test.ts`); double-cast `(x as unknown as Record<string, unknown>)['key']` pattern for `CollaborationService` private member access (TS2352); bracket notation `['gpu']` / `['__TAURI__']` required by TypeScript 6 index-signature enforcement (TS4111); PBKDF2 `Uint8Array<ArrayBuffer>` generic in `collaborationService.ts` for Web Crypto API strict typing.

- **Test mocks (2026-05-18):** `tests/unit/ErrorBoundary.test.tsx` gains `vi.mock('../../hooks/useTranslation', …)` with an EN string map so rendered-text assertions survive the i18n refactor. `tests/unit/AdvancedImportExport.test.tsx` heading assertion updated from hardcoded `'Google Docs / Notion'` to `'export.pasteSection.heading'` (consistent with the `t: (k) => k` mock pattern already used in that file).

- **E2E Desktop + Mobile Chrome (2026-05-17):** `writer`, `snapshots`, `a11y`, `export` spec files migrated to 2026 Golden Hierarchy selectors (getByRole > getByTestId; no CSS, no XPath). Fixes CI exit-code 1 after WriterView component split.

- **WebLLM model selector (Phase 3B):** `packages/ai-core` now exports `WEBLLM_SUPPORTED_MODELS` (4 curated MLC-packaged checkpoints: Llama 3.2 1B, Llama 3.2 3B, Phi-3.5 Mini, Gemma 2 2B), `WebLlmModelId`, and `WebLlmProgressReport` types. `runLocalTextGeneration` accepts an optional `modelId` and `onProgress` callback for per-model download-progress tracking. `services/localAiFacade.ts` forwards both parameters. `types.ts` expands the `AiModel` union with the four specific MLC model IDs. Settings → AI (Advanced) now shows a dynamic model dropdown populated from `WEBLLM_SUPPORTED_MODELS`, a pre-download button, a WCAG 2.2 `role="progressbar"` progress bar, and a `useRef` mounted guard that prevents `setState`-on-unmount. All 5 locale `settings.json` files gain the 3 new i18n keys (`settings.ai.webllm.model`, `settings.ai.webllm.downloadProgress`, `settings.ai.webllm.downloading`).

- **Cross-project search service (Phase 3A):** New `services/crossProjectSearchService.ts` — `searchAcrossProjects(query, projectData)` fuzzy-searches project title, logline, manuscript sections, and character names/fields using `normalizeSearch()` from `fuzzyScore.ts`; returns `CrossProjectSearchResult[]` sorted by score. Results include `projectId`, `projectTitle`, `matchType`, `excerpt` (truncated to 120 chars with `…`), and `score`. v1 scope is single-project (multi-project search requires a DB_VERSION bump + IDB migration — deferred to v2). `app/transientUiStore.ts` gains `isCrossProjectSearchOpen` + `setCrossProjectSearchOpen`. The `labs-cross-project-search` command in `services/commands/commandDefinitions.tsx` now opens the search panel instead of a stub toast. All 5 locale `common.json` files gain 7 `crossSearch.*` keys.

- **Collaboration security warning (Phase 3C):** `CollaborationPanel.tsx` displays a pre-connection security-warning banner (`role="alert"`, `aria-live="polite"`, WCAG 2.2 AA) that is only visible before connecting. The banner explains that the public y-webrtc signaling relay can observe connection metadata, includes a keyboard-accessible self-hosting link, and disappears once connected. All 5 locale `common.json` files gain `collab.securityWarning`, `collab.securityWarningDetail`, and `collab.selfHostLinkLabel`.

- **E2E tests for new features:** `tests/e2e/commands.spec.ts` — palette open/close (Ctrl+K / Escape), "dashboard" text search surfaces nav command, Enter-to-navigate, fuzzy "wrt" match. `tests/e2e/collaboration.spec.ts` — security warning `[role=alert]` is visible pre-connection and non-empty. Both specs are CI-only (`test.skip(!isCI)`).


## [1.18.1] — 2026-05-27

### Fixed

- **TypeScript strict-mode compliance sweep** — Zero `tsc --noEmit` errors across all 47 changed files:
  - **ProForge pipeline agents:** `AIRequestOptions` requires `model` + `provider`; added `buildAiOpts()` protected helper to `BaseAgent` that derives provider/model from `PipelineConfig.aiProvider` with sensible defaults. Applied to all 7 pipeline agents + `selfReflect()` in `BaseAgent`.
  - **`productionAgent.ts`:** `EpubExportOptions.author` (required field) — added `author: project.author ?? 'Unknown'`.
  - **`services/proForge/pipelineTools/toolRegistry.ts`:** Wrong module paths (`'../../app/store'`) → `'../../../app/store'`; same for `features/proForge/types`.
  - **`features/proForge/proForgeSlice.ts`:** `exactOptionalPropertyTypes` — optional properties assigned via conditional spread instead of explicit `undefined`.
  - **`features/proForge/types.ts`:** Array index access (`PIPELINE_STAGES[idx]`) returns `T | undefined` with `noUncheckedIndexedAccess` — coalesced to `?? null`.
  - **`features/versionControl/versionControlSlice.ts`:** Added stub `restoreSnapshot` reducer (cross-slice signal, no self-state mutation).
  - **`hooks/useProForgeOrchestrator.ts`:** `aiCreativity` is on root `Settings`, not `AdvancedAiSettings`.
  - **Voice components (`VoicePrivacyConsentModal`, `VoicePrivacyStatus`):** Wrong `useTranslation` import path; `Modal` named export; `setVoiceSettings` action (not `updateSettings`); `selectVoiceSettings` selector.
  - **Test fixtures (35+ test files):** Corrected for `noUncheckedIndexedAccess` (`[i]!`), removed non-existent `StorySection.type`/`order` fields, `act: 1 as const` for literal union, `AiModel`/`Theme`/`MindMapNodeType`/`StoryObjectType` valid enum values, `PrivacySettings` with all 6 required fields, `DeviceHealthReport` correct shape, `FlatHelpArticle.contentKey` (not `bodyKey`), `FeatureFlagsState.enableProForge` in mock objects.

## [1.18.0] — 2026-05-27

### Added

- **ProForge Humanization & Refinement Sprint (Phases H/A/P/X)** — Full editorial-quality overhaul of the ProForge pipeline:
  - **Phase H — UX Polish:** Author-facing stage labels and loading messages (no implementation jargon); RAG chunk count renamed to "context passages"; feature flag descriptions rewritten for non-technical readers; behavioral tests replacing implementation-detail tests.
  - **Phase A — Architecture:** `BaseAgent` abstract class eliminates ~200 LOC of duplicated scaffold across all 8 pipeline agents; `services/ai/aiConstants.ts` consolidates `CREATIVITY_TO_TEMPERATURE`, `LOCAL_BACKEND_PRESET_DEFAULT_URL`, and `ORCHESTRATION_READY_PROVIDERS` into a single source; `addDebouncedListener` factory in `listenerMiddleware.ts` replaces repeated `RootState` cast dance.
  - **Phase P — Quality Supervision:** `SupervisorAgent` — heuristic quality gates (no AI calls) that detect fallback sentinels and trigger retries via `executeStageWithSupervision`; hard gate blocks pipeline if intake `qualityScore < 30`; `BaseAgent.selfReflect()` — self-evaluation loop flags `INCOHERENT` output in `DiagnosticAgent` and `StructuralAgent` for re-run; all `createFallback*` methods now produce 0 scores + `isFallback: true` instead of fake data; `reflectionNotes`, `supervisorDecision`, and `maxRetries` fields added to relevant types.
  - **Phase P-5 — PipelineReviewPanel Redesign:** Critical Actions summary card; severity-grouped view (Critical / Warnings / Suggestions); Quick Accept High-Confidence button (confidence ≥ 0.85, non-critical, pending items only).
  - **Phase X-1 — Settings Nav Grouping:** Semantic `NAV_GROUPS` with `NavGroupHeader` component (Writing, AI Models, Appearance & Accessibility, Privacy & Data, Connections, System).
  - **Phase X-2 — Flow Mode:** Distraction-free writing mode via Zustand `transientUiStore` (`flowMode` / `setFlowMode`); `WriterViewUI` shows full-screen editor on toggle; `Escape` key exits.
  - **Phase X-3 — Empty States:** `<EmptyState>` components for Characters, World, SceneBoard, and ProForge views — contextual guidance when collections are empty.
- **i18n:** 2055 keys × 5 locales (added `proforge.pipeline.title`, `proforge.pipeline.noneActive`, loading messages, stage labels, empty-state strings across DE/EN/ES/FR/IT).
- **.gitignore:** Added `.continue/` (Continue IDE local config directory).

### Fixed

- **listenerMiddleware.ts:** `getOriginalState()` captured synchronously before the first `await` inside `addDebouncedListener` factory (RTK constraint — calling after any `await` throws at runtime).
- **WriterViewUI.test.tsx:** Added `vi.mock` for `useWriterViewContext` (component now requires the context after X-2 Flow Mode integration).
- **ProForgeDashboard.test.tsx:** Assertion updated to use i18n key string (mock `t()` returns key; component uses `t('proforge.pipeline.noneActive')`).
- **writingAndCharacterThunks / outlineAndWorldThunks / plotBoardAiThunks tests (pre-existing):** Added `vi.mock('../../../services/ai/aiPolicy', ...)` — `settingsReducer` defaults `localStorageOnly: true`, causing `assertCloudAiAllowedSync` to throw "Cloud provider blocked" and reject all 31 AI thunk tests at the gate.

## [1.17.1] — 2026-05-26

### Fixed

- **TypeScript errors in ProForge test suite** — Fixed 30+ type errors across 15 ProForge test files: `EntityState` mock completeness (`ids: []`), full `ProForgeState` shape (`isActive`, `activeView`, `defaultConfig`, `isLoading`, `error`), `PipelineStage` / `ReviewItemType` / `ReviewItemSeverity` union casts in test helpers, `activeStageResult.stage as PipelineStage`, `creativity as const` / `ragMode as const` for union literal narrowing, generic `t<T>(k) => k as unknown as T` translation mock, `versionControlActions.restoreSnapshot` biome-ignore cast.
- **Test failures in Coverage Sprint test files** — `NotificationsSection.test.tsx`: `getAllByRole('checkbox')` → `getAllByRole('switch')` (`ToggleSwitch` uses ARIA `role="switch"`); `Progress.test.tsx`: `querySelector('div > div')` returned outer div (no inline style) → `querySelector('[style]')` targets the inner bar div; `ManuscriptEditor.test.tsx`: word count badge renders `"7 common.words"` not `"7"` — fixed to regex `\b7\b`; `AnalyticsBootstrap.test.tsx`: missing `beforeEach(vi.clearAllMocks)` caused stale call count; `ragPromptAssembly.test.ts`: token budget `50` too small for 500-char body (≈173 tokens) — corrected to `200`.

### Changed

- **Dependencies (patch)** — `@ai-sdk/google` 3.0.75→3.0.79, `@ai-sdk/openai` 3.0.64→3.0.65, `@ai-sdk/react` 3.0.187→3.0.193, `ai` 6.0.185→6.0.191, `dompurify` 3.4.5→3.4.6, `@tanstack/react-virtual` 3.13.25→3.13.26, `vite` 8.0.13→8.0.14, `vitest` + `@vitest/coverage-v8` 4.1.6→4.1.7, `storybook` suite 10.4.0→10.4.1, `@types/node` 25.9.0→25.9.1, `@types/react` 19.2.14→19.2.15.
- **Dependencies (minor)** — `@google/genai` 2.4.0→2.6.0, `docx` 9.6.1→9.7.0, `vite-plugin-pwa` 1.2.0→1.3.0, `wrangler` 4.93.1→4.94.0.

## [1.17.0] — 2026-05-24

### Added

- **Voice Full Support Foundation** — Abstract Engine Interfaces (`SttEngine`, `TtsEngine`, `VadEngine`, `WakeWordEngine`, `IntentEngine`), Web Speech API Fallbacks, Hybrid Intent Engine (exact → Jaccard → slot extraction), VoiceCommandService with State Machine (idle → listening → processing → speaking), Redux `voiceSlice`, React Hooks (`useVoice`, `usePushToTalk`, `useVoiceDictation`, `useVoiceAccessibility`), UI Components (`VoiceIndicator`, `VoiceControlPanel`, `VoiceSettingsSection`), Audio Navigator (ARIA landmark scanning), Feedback Service (3 verbosity levels). 83 unit tests across 9 test files.
- **CodeGraph semantic code intelligence** — dual-graph setup alongside Graphify: symbol-level MCP server (caller/callee/impact/trace), auto-sync file watcher, `codegraph affected` for smart test selection. Indexed: 260 files, 2754 nodes, 2443 edges. See [`docs/codegraph.md`](docs/codegraph.md) and [`docs/dual-graph-setup.md`](docs/dual-graph-setup.md).
- `pnpm` scripts: `codegraph:status`, `codegraph:update`, `codegraph:sync`, `codegraph:report`, `codegraph:affected`, `graphs:update`.
- VS Code: tasks for CodeGraph and dual-graph updates.
- **Design System Audit Completion** — DS-1 (legacy CSS bridge variable removal), DS-2 (elimination of all `dark:` Tailwind prefix violations across components), DS-4 (radius tokens). All P0+P1 Design-System items completed.
- **Mobile UX Comprehensive Pass** — Touch targets ≥44px, bottom tab bar, foldable layout (`useFoldableLayout`), sidebar layouts, hover-only actions removed, safe-area padding, bottom navigation clearance (`pb-mobile-nav`).
- **DevContainer** — Full `.devcontainer/` configuration with Dockerfile, Starship prompt, VS Code extensions, and tooling documentation.
- **LoRA Adapter Inference Foundation** — Feature flag `enableLoraSupport`, IDB service (`loraAdapterService`), Settings-UI for personalized writing styles.
- **Plugin System v0.1** — Sandboxed Capability API, plugin registry (`pluginRegistryService`), Settings-UI.
- **Visual Regression Testing (VRT)** — Playwright screenshot suite, CI job `vrt.yml`, baseline snapshots.
- **RTL Layout Foundation** — Feature flag `enableRtl`, BiDi context provider, `html[dir]` control for Arabic/Hebrew/Persian support.
- **Cloud Sync Stub (SYNC-1)** — E2E-encrypted cloud sync foundation (AES-256-GCM, Cloudflare R2 stub).
- **Performance (PERF-1)** — `useDeferredValue` for large manuscripts, 500-scene notice, virtual scrolling foundation.
- **Community Section (COM-1)** — Curated model list, GitHub links in Settings.
- [`docs/REPO-HOUSEKEEPING.md`](docs/REPO-HOUSEKEEPING.md) — GitHub language stats and i18n layout.
- **Full RTCDataChannel in-flight E2E encryption** — `pnpm patch` for `y-webrtc@10.3.0` encrypts all Yjs sync updates and awareness protocol messages over peer-to-peer WebRTC data channels via AES-256-GCM using `room.key`. Previously only signaling and BroadcastChannel were encrypted; data channel traffic was plaintext.

### Fixed

- **i18n cold start:** Project title/logline no longer persist as raw keys (`initialProject.title`); sync bootstrap + repair on load.
- **Repo languages:** `.gitattributes` + solo Graphify policy (`graphify-out/*` gitignored except `GRAPH_REPORT.md`); removed stale `public/locales/*` module copies (runtime uses `bundle.json` only).
- **Voice state migration:** `selectVoiceSettings` guarded against missing `voice` key in old persisted state.
- **Security:** pnpm override for CVE `qs>=6.15.2`.
- **Vercel deploy:** `pnpm-lock.yaml` updated to include `patchedDependencies` for `y-webrtc@10.3.0`, resolving `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` on frozen install.

## [1.11.0] — 2026-05-22

### Fixed

- **Cloudflare deploy (P0):** `scripts/resolve-deploy-base.mjs` used undefined variable `base`; corrected to `deployBase`. `sync-deploy-base.mjs` now propagates errors with `process.exit(1)` and uses `const` correctly.
- **StorageBackend resilience:** `saveProject()` and `saveSettings()` in `services/dbService.ts` now wrap IDB writes in `retryDb()` (2 retries, 500 ms delay on quota/state errors). Settings auto-save failures surface as an error toast.
- **Init recovery UI:** `index.tsx` mounts a `StorageErrorScreen` React component on DB init failure (instead of a raw red `div`), offering Reload and Reset Database buttons.
- **Lint:** `scripts/sync-deploy-base.mjs` `let text` → `const text`; `App.tsx` removed redundant `language` dependency from `useEffect`.

### Added

- **`services/dbInitialization.ts`** — `initializeStorage()` (returns `{ success, migrated, error? }`) and `resetAllDatabases()` (deletes both IDB stores + localStorage markers).
- **Help Center articles:** All 13 previously stub articles (< 300 chars) fully written to 700–1000 chars of HTML content across all 5 locales (de/en/es/fr/it). 1931 keys × 5 locales verified at parity.
- **Tests:** `tests/unit/dbInitialization.test.ts` (8 tests) + `tests/unit/dbServiceRetry.test.ts` (7 tests).

## [1.10.0] — 2026-05-21

### Added

- **Help articles:** Plot Board v2 canvas deep dive, Hybrid RAG guide, Tauri desktop documentation (all 5 locales).
- **Tests:** Indexed help search, extended `ragPromptAssembly` branches, `plotLayoutUtils` grid snap, branch coverage gate **≥55 %**.
- **Mobile:** Bottom tab bar shows **Scene Board** instead of Characters (desktop sidebar unchanged); `pb-mobile-nav` clearance for scroll content.

### Changed

- Help search pre-builds translated index per locale (faster typing, less jank).
- Settings → About includes `TauriUpdaterBanner`; updater auto-check only on About (not entire Settings).
- Vitest branch threshold raised from 48 % to **55 %**.

### Fixed

- Mobile main content no longer hidden behind bottom navigation (safe-area + tab bar padding).
- Help AI chat scrolls on new messages; suggestion chips submit correctly; i18n error message.
- Settings search syncs active category when filter hides current section; empty-search state.

## [1.9.0] — 2026-05-21

### Added

- **Lazy loading & cold start:** dynamic DuckDB/RAG in `listenerMiddleware`, deferred `aiApi` provider load, lazy Plot Board sub-components, `react-force-graph-2d`, `CollaborationPanel`; `AnalyticsBootstrap` + `useDuckDb` when flag on.
- **Help Center overhaul:** `helpCatalog.ts` (50+ articles), full-text search, **Technical Documentation** category, expanded AI help RAG chunks; complete **es/fr/it** article translations.
- **Settings guide:** dedicated category with links to all 18 areas; **Experimental flags** section with all 12 toggles; overview quick links on General.
- **Dashboard:** `BackupQuickActionsCard` (export/import JSON, latest snapshot, link to Backup settings).
- **Plot Board polish:** `PlotMinimap` component, long-press on cards, 44px connection touch targets, `prefers-reduced-motion` pan path.
- **Tauri desktop:** native File/Help menu → `menu-action` events, `tauri-plugin-window-state`, updater banner in About, open data folder, runtime version display.
- **Resilience:** `ViewErrorBoundary` with retry + live-region announce; `withTransientRetry` on AI provider attempts.
- **Docs:** [`docs/SPRINT-V1.9.md`](docs/SPRINT-V1.9.md); updated [`README.md`](README.md), [`AUDIT.md`](AUDIT.md), [`docs/TAURI-CI.md`](docs/TAURI-CI.md), [`docs/TAURI-UPDATER.md`](docs/TAURI-UPDATER.md).

### Changed

- Feature flags UI moved from Advanced AI to **Settings → Experimental flags**.
- Bundle budget script supports `--max-entry-kb`; Vite `plot-board` manual chunk.

## [1.8.0] — 2026-05-21

### Added

- **RAG prompt assembly** (`services/ragPromptAssembly.ts`): Writer continuation, Plot Board beat suggestions, token-budgeted context blocks.
- **DuckDB semantic vectors**: `rag_chunks.embedding` (384-dim), `ragVectorMigration.ts`, dual-write uses MiniLM embeddings.
- **Writer UI**: RAG context toggle and retrieved-chunk badge.
- **Plot Board**: AI suggest beat + modal (`plotBoardAiThunks`, `usePlotBoardAi`).
- **Docs**: [`docs/SPRINT-V1.8.md`](docs/SPRINT-V1.8.md), [`docs/PWA-AUDIT.md`](docs/PWA-AUDIT.md).
- **Deployment**: Vercel (`vercel.json` + `build:edge`), Cloudflare Pages (`wrangler.toml`, `_redirects`, `_headers`, optional GH workflow), expanded [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

### Fixed

- **Typecheck**: `MindMapListPanel` `exactOptionalPropertyTypes`; DuckDB worker typings (`types/duckdb-wasm-worker.d.ts`).

## [1.7.0] — 2026-05-20

### Added

**DuckDB-WASM Analytics Layer (P0–P3):**
- `workers/duckdbWorker.ts` — off-main-thread DuckDB-WASM (duckdb-eh bundle), OPFS persistence with in-memory fallback. Message protocol mirrors inference.worker.ts (messageId correlation, AbortController, OPFS_FALLBACK event).
- `services/duckdb/duckdbClient.ts` — singleton proxy with AbortSignal support, in-flight cancellation, init retry (3×, exponential backoff), OPFS fallback handler.
- `services/duckdb/duckdbSchema.ts` — schema v1: `projects`, `sections`, `writing_history`, `writing_sessions`, `characters`, `rag_chunks` (FLOAT[] vector), `cross_project_index`, `codex_entities`, `codex_mentions`, `readability_snapshots`. Analytics views: `v_daily_progress`, `v_weekly_progress`, `v_section_metrics`, `v_scene_overlap`, `v_character_cooccurrence`.
- `services/duckdb/duckdbAnalytics.ts` — `queryDailyProgress`, `queryWeeklyProgress`, `queryStreak`, `querySceneOverlaps`, `queryRagSimilarity` (via `list_dot_product()`), `queryCharacterCoOccurrence`, `queryCrossProjectSearch`. `duckdbDualWrite`, `duckdbRagWrite`, `duckdbCrossProjectWrite`, `duckdbCodexWrite`. `withDuckDbRetry` retry wrapper.
- `services/duckdb/duckdbMigration.ts` — idempotent IDB→DuckDB seed migration with `_meta` version marker.
- `hooks/useDuckDb.ts` — initialization hook with 30 s timeout, auto-retry, OPFS fallback dispatch, `queryAsync` / `execAsync`.
- `hooks/useAnalytics.ts` — feature-flagged analytics hook; parallelizes 4 queries; OPFS-unavailable toast.
- Feature flag `enableDuckDbAnalytics` in `featureFlagsSlice`.

**Hybrid RAG — Wired End-to-End:**
- `ragMode: 'lexical' | 'hybrid'` added to `AdvancedAiSettings` (default `'hybrid'`). Persisted to IDB via `dbService.ts` migration defaults.
- Settings UI: RAG mode selector (Hybrid / Lexical) in Advanced AI → Local Search Index section.
- Fix: Settings "Rebuild local search index" button now calls `rebuildHybridRagIndex` (was `rebuildLocalRagIndex` — lexical only). DuckDB dual-write enabled when `enableDuckDbAnalytics` flag is on.
- Consistency Checker (`useConsistencyCheckerView`) now retrieves top-8 RAG chunks before the AI call and injects them into the prompt as `ragChunks`, replacing the full 50 000-char manuscript block. Graceful fallback when RAG index is empty or embedding model unavailable.
- Re-Index for AI button added to `ReferencePanelView` footer — on-demand index refresh with success toast showing chunk count.
- i18n: 3 new `settings.advancedAi.ragMode*` keys + 5 `reference.reindex.*` keys across all 5 locales.

**AI Provider Extensions:**
- ONNX Runtime Web (Layer 2) and Transformers.js (Layer 3) selectable as primary providers in AI Settings.
- Service-level dedup wrapper (`aiThunkUtils.ts`) prevents concurrent duplicate AI requests.
- Per-project AI preset: project-scoped provider/model stored in `advancedAi.localBackendPreset`; harden dedup key; hash-based deep links (`#/board`, `#/preview`, `#/progress`, `#/project/{id}/scene/{id}`).
- `WorkerBus` backpressure guard: `MAX_QUEUE_SIZE` = 32; critical tasks bypass; telemetry extended (`peakLatencyMs`, `errorRate`).

**Collaboration:**
- Y-WebRTC E2E encryption (`collaborationService.ts`): `encryptUpdate()`, `decryptUpdate()`, `deriveEncryptionKey()` (PBKDF2 600 000 iter, SHA-256, AES-256-GCM). Deterministic salt from projectId. `CollaborationPanel` status badge (green `E2E Key Derived` / amber `Room isolation only`).

**Performance:**
- `PlotCanvas.tsx`: pointer-move handler throttled via `requestAnimationFrame`; prevents 60 Hz Redux dispatch storm during canvas pan/zoom.

### Changed

- `localRagService.ts` auto-rebuild now correctly dual-writes to DuckDB when `enableDuckDbAnalytics` is on (5 s debounce in `listenerMiddleware`).
- `geminiService.ts` `consistencyCheck` case: accepts optional `ragChunks` param; uses RAG excerpts instead of full manuscript when present.
- i18n: 1 590 → **1 625 keys** × 5 locales.

### Fixed

- `dbService.ts` migration defaults: `advancedAi.ragMode` added so existing IDB state without the key is upgraded to `'hybrid'` on first load.
- `DuckDB` resilience: init retry (3×), dual-write retry (3×), OPFS fallback to in-memory when `navigator.storage.getDirectory()` unavailable, error surfaces to Redux `analyticsActions.setDuckDbError`.

## [1.6.2] — 2026-05-20

### Refactored

- **Plot-Board content moved to projectSlice (undo-able):** Connections, subplots, and tension overrides now live in `features/project/projectSlice.ts` (and thus inside `redux-undo`) instead of `plotBoardSlice`. `plotBoardSlice` is now viewport/UI-state only (zoom, pan, mode, draw-state). New actions: `addPlotConnection`, `updatePlotConnection`, `removePlotConnection`, `removePlotConnectionsForSection`, `finishPlotDrawConnection`, `addPlotSubplot`, `updatePlotSubplot`, `deletePlotSubplot`, `assignSectionToPlotSubplot`, `removeSectionFromPlotSubplot`, `setPlotTensionOverride`, `clearPlotTensionOverride`, `clearAllPlotTensionOverrides`. New selectors in `projectSelectors.ts`: `selectPlotConnections`, `selectPlotSubplots`, `selectPlotTensionOverrides`. All five scene-board components (`ConnectionLayer`, `ConnectionToolbar`, `PlotCanvas`, `SubplotPanel`, `TensionCurvePanel`) updated to dispatch project actions and read from project selectors. `handleDeleteSection` now also dispatches `removePlotConnectionsForSection` to keep the board consistent.

### Added

- **Locale-aware readability metric:** `services/readabilityFlesch.ts` now supports five language-specific formulas — EN: Flesch Reading Ease, DE: Amstad (1978), FR: Kandel-Moles, ES: Fernández Huerta, IT: Gulpease — instead of a single English-centric heuristic. `estimateSyllables(word, locale)` uses per-locale vowel patterns (including diacritics). `useDashboard.ts` passes the active locale to `computeReadabilitySnapshot`. Dashboard i18n labels updated in all four non-English locales to name the correct formula.

### Fixed

- **docker.yml token permissions (CodeQL):** Top-level `permissions` block now sets only `contents: read`; `packages: write` scoped to the `build-push` job only — follows principle of least privilege as required by CodeQL Token-Permissions rule.
- **biome.json schema version:** Updated `2.4.12` → `2.4.15` to match installed Biome CLI.

### Tests

- `tests/unit/plotBoardSlice.test.ts`: Subplot/connection/tension test suites removed (migrated to `projectSlice`); viewport tests retained.
- `tests/unit/projectSlice.test.ts`: 15 new tests covering plot connections (incl. undo, dedup, self-loop guard), subplots (CRUD, section-assign), and tension overrides.
- `tests/unit/hooks/useSceneBoardView.test.ts`: `handleDeleteSection` test extended to verify `removePlotConnectionsForSection` dispatch; `plotBoard` mock state simplified (no connections/subplots/tensionOverrides).
- `tests/unit/SceneBoardView.test.tsx`, `SubplotPanel.test.tsx`, `ConnectionLayer.test.tsx`, `TensionCurvePanel.test.tsx`: mock state updated to new plotBoard shape.
- `tests/unit/thunkUtils.test.ts`: default model assertion updated `gemini-2.5-flash → gemini-3.5-flash` (settingsSlice default changed in v1.6.1).
- **Total: 2 024 tests / 178 files — 0 failures. Coverage: 65.91% lines / 50.59% branches / 56.74% functions / 64.25% statements.**

## [1.6.1] — 2026-05-19

### Added

- **Gemini 3.x model catalogue:** Default model bumped to `gemini-3.5-flash`; Gemini 3.1 Pro Preview, 3.1 Flash, and 3.1 Flash-Lite added to the provider dropdown. Legacy `gemini-2.0-flash` removed; `gemini-2.5-x` stable group retained. All fallback model IDs updated across `geminiService`, `storyCraftCompletionFetch`, `dbService` migration, `AiSections`, and `settingsSlice`.
- **Docker image:** Multi-stage `Dockerfile` (builder → nginx:1.27-alpine runner); `.dockerignore`; `docker.yml` GitHub Actions workflow (GHCR push on `v*` tags / `workflow_dispatch`).
- **Tauri v1.6:** `tauri.conf.json` + `Cargo.toml` version bumped `1.4.0 → 1.6.0`; auto-updater set `active: true`; `TAURI-CI.md` example tag updated to `v1.6.0`.

## [1.6.0] — 2026-05-19

### Added (v1.6 — Plot-Board v2 & Writer Experience Sprint)

**Plot-Board v2** (Days 1–3 — the Killer Feature):
- **Free-form canvas mode:** Scene cards positioned absolutely on a pannable/zoomable CSS-transform canvas; tap/drag updates `sceneBoardLayout` in Redux. Pan: pointer-capture on background; zoom: wheel + two-pointer pinch (0.25×–4×). Mini-map: 80×50 px fixed SVG overview in corner.
- **SVG Connection Layer:** Cubic-bezier paths between scene cards rendered in `ConnectionLayer.tsx`; connection types: `cause-effect`, `parallel`, `subplot`, `temporal`, `character-arc`. Invisible 18 px thick hit-test `<path>` (`pointer-events: stroke`) with `role="button"` + `tabIndex` for keyboard access.
- **Subplot System:** `SubplotPanel.tsx` — collapsible sidebar with color-swatch list, inline name edit, `<input type="color">` picker, filter toggle that dims unrelated scenes.
- **Connection Toolbar:** Floating `ConnectionToolbar.tsx` appearing when a connection is selected — type select, label input, delete.
- **Tension Curve Panel:** `TensionCurvePanel.tsx` — 800×200 SVG chart with auto-computed tension (status-based score 0–10) and user drag-overrides. Beat sheet overlays: Three-Act, Save the Cat!, Hero's Journey marker presets. Collapsible below the canvas.
- **Mode Tab Bar:** Swimlane | Canvas | Timeline three-segment control in `SceneBoardView.tsx` toolbar dispatches `plotBoardActions.setActiveMode`.
- **Feature flag:** `enablePlotBoardV2: boolean` (default `true`) in `featureFlagsSlice.ts`.
- **Snap-to-grid option** (8 px) for canvas drag in `PlotCanvas.tsx`.
- **New Redux slice `features/plotBoard/plotBoardSlice.ts`:** Manages canvas viewport (zoom, pan), connections, subplots, tension overrides, draw-mode state. Persists to `localStorage` key `storycraft-plot-board`. NOT wrapped by `redux-undo`.
- **New service `services/plotBoardService.ts`:** `computeTensionCurve()`, `autoLayoutScenes()`, `exportBoardAsSvg()`.
- **Architecture doc `docs/PLOT-BOARD.md`:** Connection types, beat sheet reference, canvas gesture guide.
- **Mobile canvas gestures:** Pinch-to-zoom, two-finger pan, long-press background → add scene at pointer position.

**Real-Time Book Preview** (Day 4):
- **`components/BookPreviewView.tsx` + `hooks/useBookPreviewView.ts` + `contexts/BookPreviewContext.ts`:** Scrollable book-style rendering of all manuscript sections as `<article>` elements. IntersectionObserver (threshold 0.3) drives an active TOC entry.
- **Controls bar:** Font size (12–24 px), font family (system-ui / serif / monospace), word-count annotation toggle, fullscreen mode (`position: fixed inset-0 z-50`).
- **Collapsible TOC sidebar:** Fixed-position; keyboard scroll via `scrollIntoView`; active section highlighted.
- **Registered** as lazy-loaded view in `App.tsx` (`case 'preview'`) and `APP_SECTIONS` in `constants/sections.tsx`.

**Reference Panel / Split-View** (Day 5):
- **`components/manuscript/ReferencePanelView.tsx`:** 6-tab panel (`Characters | World | Notes | Binder | Comments | Revisions`) with `role="complementary"` + `aria-label`. Tab buttons use `role="tablist"` / `role="tab"` / `aria-selected` / `aria-controls`.
- **Characters tab:** Mini-cards for scene's `characterIds[]` with avatar placeholder and backstory excerpt.
- **World tab:** Linked location mini-description and geography excerpt.
- **Notes tab:** Inline editable `<textarea>` synced to `currentSection.notes` via `updateManuscriptSection`.
- **Binder tab:** BinderNode links for current section.
- **Comments & Revisions tabs:** Integrate `CommentsPanel` and `SceneRevisionPanel` (see Day 6).

**Per-Scene Revision History + Threaded Comments** (Day 6):
- **`services/sceneRevisionService.ts`:** IndexedDB `scene-revisions` store; `saveRevision()`, `listRevisions()` (newest-first, max 50 per scene), `deleteRevision()`. `_resetDbForTest()` exported for test isolation.
- **`components/manuscript/SceneRevisionPanel.tsx`:** Word-level diff view using `services/wordDiff.ts`; two-step restore (confirm button); labeled snapshot save.
- **`features/sceneComments/sceneCommentsSlice.ts`:** EntityAdapter for `SceneComment` with selectors `selectCommentsBySection`, `selectUnresolvedCount`, `selectUnresolvedCountBySection`. Actions: `addComment`, `resolveComment`, `unresolveComment`, `addReply`, `deleteComment`, `deleteCommentsForSection`.
- **`components/manuscript/CommentsPanel.tsx`:** Thread expand/collapse, inline reply input (Enter to send), resolve/unresolve/delete buttons with `role="list"` / `role="listitem"` ARIA semantics.
- **New types in `types.ts`:** `SceneRevision`, `SceneComment`, `CommentReply`.

**Progress Tracker Dashboard** (Day 7):
- **`features/progressTracker/progressTrackerSlice.ts`:** `startSession`, `endSession` (calculates `wordsWritten = current - start`, prevents negative delta), `setDailyGoal` (clamps ≥ 1), `setWeeklyGoal`, `syncStreak`. Exported pure function `computeStreak(history)`.
- **`components/ProgressTrackerView.tsx` + `hooks/useProgressTrackerView.ts` + `contexts/ProgressTrackerContext.ts`:** 2-column dashboard (single-column mobile): circular SVG progress ring, live session timer (`role="timer"`), daily/weekly goal bars, 30-day SVG area velocity chart with gradient fill, 12-week GitHub-style heatmap (84 `<rect>` cells, 5 intensity shades).
- **Registered** as lazy-loaded view (`case 'progress'`) in `App.tsx` and `APP_SECTIONS`.
- **Session shortcut `Ctrl+Shift+S`** to start/stop writing sessions.

**Mobile Polish** (Days 8–9):
- **`hooks/useFoldableLayout.ts`:** Reads `env(fold-top)` / `env(fold-left)` CSS environment variables (W3C Device Posture API). Returns `{ isFolded, foldAxis: 'horizontal'|'vertical'|null, foldPosition }`. Applied in `App.tsx` as `data-fold-axis` on `<body>`.
- **`services/deepLinkService.ts`:** URL hash routing (`#/project/{id}`, `#/project/{id}/scene/{sectionId}`, `#/board`, `#/preview`, `#/progress`). `parseHash()`, `pushHash()`, `readCurrentView()`.
- **`hooks/useHaptics.ts` upgraded:** Named `HAPTIC_PATTERNS` library — `scene-drop`, `connection-made`, `streak-milestone`, `session-start`, `goal-achieved`, `error`. `HapticPattern` type exported.

### Changed

- **`hooks/useSceneBoardView.ts`:** Extended with `handleAddConnection`, `handleDeleteConnection`, `handleStartDrawConnection`, `handleFinishDrawConnection`, `handleCancelDrawConnection`, `handleAddSubplot`, `handleDeleteSubplot`, `handleAssignToSubplot`.
- **`contexts/SceneBoardViewContext.ts`:** Extended with new connection/subplot handlers.
- **`components/SceneBoardView.tsx`:** Refactored to orchestrate `PlotCanvas`, `ConnectionLayer`, `SubplotPanel`, `TensionCurvePanel`, `ConnectionToolbar`; mode tab bar wired to `plotBoardActions.setActiveMode`.
- **`components/scene-board/` subcomponents extracted:** `SceneCard.tsx`, `ActSwimlane.tsx` (previously inline in `SceneBoardView.tsx`).
- **i18n:** 131 new keys (preview 21 + progress 25 + reference 11 + comments 13 + revisions 13 + plotboard 20 + mobile 6 + haptics 2 = 131) → **1590 keys × 5 locales**.
- **`app/store.ts`:** Registered `plotBoard`, `progressTracker`, `sceneComments` reducers.
- **`types.ts`:** Added `Subplot`, `PlotConnection`, `SceneRevision`, `SceneComment`, `CommentReply` interfaces.
- **`workers/inference.worker.ts`:** Added `@ts-expect-error` for `@xenova/transformers` dynamic import (lives in `packages/ai-core`; Vite resolves at build time — pre-existing resolution gap in `tsc`).

### Tests

- **174 test files / 1966 tests** (up from 166/1851) — 0 failures.
- New: `plotBoardSlice.test.ts`, `plotBoardService.test.ts`, `ConnectionLayer.test.tsx`, `SubplotPanel.test.tsx`, `TensionCurvePanel.test.tsx`, `sceneRevisionService.test.ts`, `sceneCommentsSlice.test.ts`, `progressTrackerSlice.test.ts`.
- Fixed: `useSceneBoardView.test.ts` mock state extended with `plotBoard` shape; `ConnectionLayer.test.tsx` updated to use `data-testid="connection-group"` (biome correctly removed redundant `role="img"` from `<g>` inside `role="img"` SVG).

## [1.5.0] — 2026-05-18

### Added (v1.5 Master Perfection Run)

- **WorkerBus v2:** Backpressure cap (32-task queue), priority preemption (max 3× requeue), AbortController map, `cancel(taskId)`, extended telemetry (`peakLatencyMs`, `errorRate`, `lastSuccessAt`).
- **GpuResourceManager:** Mutex for WebLLM/ONNX-WebGPU consumers; priority queue; 30s auto-release deadlock prevention.
- **DeviceHealthService:** Full device report (CPU cores, memory heap, storage quota, battery level, GPU VRAM tier, device class). `getModelRecommendation()` maps tier × task to concrete model IDs.
- **EcoModeService:** Battery API integration; explicit override API; `applyAdaptiveMode()`.
- **InferenceProgressEmitter:** Pub/sub progress snapshots for WebLLM loading; `subscribeWebLlmLoading()`, `reportWebLlmProgress()`, `reportWebLlmReady()`, `reportWebLlmError()`, `reset()`.
- **Active ONNX + Transformers.js inference:** `inference.worker.ts` — WorkerBus protocol, pipeline cache (8 entries), trusted-message origin guard, AbortController integration. Layers 2 & 3 now perform real inference instead of returning echo strings.
- **AiInferenceCacheService:** Two-layer LRU — in-memory 64 entries (DJB2+FNV hash) + IndexedDB 256 entries (7-day TTL). Skips cache for prompts > 512 chars.
- **LocalEmbeddingService:** `Xenova/all-MiniLM-L6-v2` 384-dim embeddings; L2-normalised; worker-offloaded; micro-batch (8); `embedText()`, `embedBatch()`, `cosineSimilarity()`.
- **LocalNlpService:** Sentiment analysis (distilbert), summarisation (distilbart), keyword topic classification — all worker-offloaded via WorkerBus.
- **LocalAiDownloadProgress:** WCAG 2.2 AA modal (`role="progressbar"`, `aria-valuenow`, `aria-valuetext` with ETA, `aria-live="polite"/"assertive"`, `role="dialog"`, focus on open, cancel button).
- **GpuMetricsPanel:** GPU queue state, WorkerBus telemetry, device-class badge, eco-mode toggle (`role="switch"`). Feature-gated by `enableAppHealthPanel`.
- **Model recommendations engine:** `getModelRecommendationForTask(task, report, ecoMode)` — VRAM tier × task → concrete model IDs. `getProviderSpeedEstimate()` for Ollama ping.
- **Hybrid RAG service (`localRagService.ts`):** Token-based chunking (300 tokens, 50-token overlap), MAX_CHUNKS 500, `indexedAt` recency field. `retrieveContext()` with `'lexical'|'semantic'|'hybrid'` modes; hybrid = 60% semantic + 30% token overlap + 10% recency; sliding window 3 most-recent chunks always included.
- **Cross-Project AI enrichment:** `enrichProjectIndex()` generates `aiSummary` (100 chars) + `embeddingVector` from local model. `semanticSearchProjects()` uses cosine similarity with keyword fallback.
- **Mobile: PointerEvent resize handles:** `ManuscriptView.tsx` upgraded from `MouseEvent` to `PointerEvent` with `setPointerCapture()` / `releasePointerCapture()`. `touch-action: none` on drag handles.
- **useSwipeGesture:** PointerEvent swipe detection; threshold + velocity window; dominant-axis direction. Wired to `WriterViewUI` mobile panel switching.
- **useLongPress:** PointerEvent long-press; 10px movement cancel threshold; configurable ms duration.
- **useHaptics:** `navigator.vibrate()` wrapper with graceful degradation.
- **BottomSheet:** WCAG 2.2 compliant drawer; `role="dialog"`, `aria-modal`, focus trap (querySelectorAll-based), Escape to close, drag-to-dismiss (> 30% height), `touch-action: none`.
- **PromptLibrary:** 17 original prompts + 3 new (styleTransfer, plotHoleFix, chapterAutoGeneration) in a versioned, category-organised registry. `getPrompt(id, vars)`, `listByCategory()`, `exportPromptLibrary()`, `importPromptLibrary()` with JSON validation. A/B variant selection.
- **StyleTransfer prompt:** `geminiService` case `'styleTransfer'` — author voice mimicry with `authorStyle` exemplar. Returns JSON `{ transformed, voiceNotes }`.
- **PlotHoleFix prompt:** `geminiService` case `'plotHoleFix'` — extends detection with chainable fix generation. 2048-token thinking budget.
- **ChapterAutoGeneration prompt:** `geminiService` case `'chapterAutoGeneration'` — outline section → full chapter. 8192-token extended thinking budget.
- **PluginRegistry:** `PluginDescriptor` interface; `register()`, `unregister()`, `getByType()`, `list()`, `size`, `clear()`. Singleton `pluginRegistry` export.
- **UsageAnalyticsService:** Opt-in only (default: off). Ring buffer 500 events. `track()`, `getAnonymizedSummary()`, `flush()`. No PII — event type + timestamp + device class only.
- **Updated AI model catalogue (2025 releases):** WebLLM list now includes Qwen 2.5 0.5B, Phi-4 Mini 3.8B, Gemma 3 1B/4B, Llama 3.3 70B. ONNX default model updated to SmolLM2-135M-Instruct (replaces DistilGPT-2). OpenAI model list adds GPT-4.1, o3, o4-mini. aiProviderService validates `o\d` prefixes alongside `gpt-`.
- **DeepWiki badge** added to README header.

### Changed

- i18n: 20 new keys for download progress + GPU panel (1459 total across 5 locales).
- `services/ai/index.ts` now re-exports all Day 4 service functions.
- `crossProjectIndexService.ts`: `ProjectSearchIndex` gains optional `aiSummary` and `embeddingVector` fields.

## [1.4.0] — 2026-05-12

### Added

- **Command Center:** Central **`services/commands/`** registry consumed by **`components/CommandPalette.tsx`** — fuzzy search with highlights, sections, **recent/pinned** commands (persisted), optional on-device **AI-suggested** rows, voice query unchanged; **`CommandExecutorProvider`** (`contexts/CommandExecutorContext.tsx`) + **`runCommandById`** for Help „Try it“ and toast **`commandId`** actions.
- **Global shortcuts:** **`hooks/useGlobalKeyboardShortcuts.ts`**, **`services/keyboard/`** (matching + conflict hints), expanded defaults in **`features/settings/keyboardShortcutsDefaults.ts`**, **Settings → Shortcuts** (`components/settings/ShortcutsSection.tsx`); palette visibility via **`app/transientUiStore.ts`**.
- **Settings hub:** Top-of-view **search** over registered control hints (`services/settingsSearchHints.ts`); **settings JSON import/export** (Zod, non-sensitive subset) in **Data** (`services/settingsExchange.ts`).
- **Help:** **RAG-lite** static retrieval (`services/help/helpDocRetrieval.ts`) injected into **`streamAiHelpResponse`**; locale articles support **`tryActionId`**; **`spotlightTour`** accepts **`tourId`** (e.g. navigation preset).
- **UI / polish:** **`components/ui/Tooltip.tsx`**, **`EmptyState.tsx`**; manuscript empty state; **ErrorBoundary** „Report issue” GitHub link; dashboard **Project Health** card behind **`enableProjectHealthScore`**; **`enableCrossProjectSearch`** stub for future cross-project search.

- **CI hardening:** Composite setup action (`.github/actions/setup/action.yml`) centralises Node + pnpm bootstrap across all 8 jobs — eliminates 4-step duplication and guarantees `--frozen-lockfile` on every runner. `gitleaks` secrets scan added to the `security` job. SLSA build provenance attestation (`actions/attest-build-provenance@v2`) attached to every `main` build. OpenSSF Scorecard (`scorecard.yml`) runs weekly and on `main` push — SARIF uploaded to GitHub Code Scanning. Dependabot configured for npm (weekly, dev-tooling PRs grouped) and GitHub Actions (weekly, max 5 open PRs).
- **Lighthouse accessibility gate:** `categories:accessibility` assertion promoted from `warn` to **`error`** at `minScore: 0.88` in `.lighthouserc.cjs` — WCAG 2.2 enforcement now blocks CI rather than just warning.
- **pnpm strict config:** `.npmrc` gains `strict-peer-dependencies`, `engine-strict` (Node ≥ 22), `prefer-frozen-lockfile`, `verify-store-integrity`. `pnpm-workspace.yaml` corrected from `allowBuilds` (map, silently ignored by pnpm v10) to `onlyBuiltDependencies` (list — the actual v10 field); `@google/genai` and `sharp` added.
- **GitHub Actions SHA pinning:** All actions across `ci.yml`, `tauri-build.yml`, `scorecard.yml`, and the composite setup action now reference immutable commit SHAs (with `# vN` version comments) — eliminates tag-mutable supply-chain attack surface. Action versions also bumped: `actions/checkout` v5→v6, `actions/configure-pages` v5→v6, `actions/download-artifact` v6→v8, `actions/dependency-review-action` v4→v5, `codecov/codecov-action` v5→v6.
- **CodeQL SAST:** `.github/workflows/codeql.yml` added — JavaScript/TypeScript static analysis runs on every push to `main`, every PR, and weekly. Results uploaded to GitHub Code Scanning.
- **Branch protection:** `main` branch protected — 1 required approving review, stale reviews dismissed, required conversation resolution, required status checks (`security`, `quality` ×2, `build`), force-push and deletion blocked.

- **Hybrid-AI settings:** Local backend **presets** (Ollama/LM Studio/vLLM/custom URLs), optional **OpenAI-compatible base URL** + OpenRouter-style attribution headers, configurable **fallback chain** for legacy AI thunks; desktop **local port scan** for `/v1/models`; model recommendation hints for Ollama.
- **Gold-Standard author pipeline (offline-first):** Binder blob storage + import/GC; manuscript research split; compile profile / norm-page TXT / EPUB matter; optional **Tauri Pandoc** EPUB (`pandoc_markdown_to_epub`) with JS fallback; VC snapshot **word-level diff** (bounded rows); scene **timeline** UI + rule engine (capped hints); dashboard **readability** sampling + timeline summaries (bounded text samples); optional **LanguageTool** (user URL + privacy gate); **local RAG** index rebuild → `saveRagVectors`; WebGPU tab **leader election** for WebLLM; settings **local RAG rebuild** control.

### Changed

- **Performance:** Manuscript metrics sampling (`services/manuscriptMetricsSampling.ts`), diff/word-diff caps, scene timeline DOM caps, RAG rebuild yields between sections — tuned for low-end hardware.

### Fixed

- **Characters:** "Add Manually" opens the dossier immediately again (dispatch + local selection state).
- **Playwright (CI):** Gemini route mock returns `candidates[].content.parts[].text` for `@google/genai`; import E2E follows **Import Project** → modal → **Import**; VC snapshot assertions avoid `[aria-label*="snapshot"]` matching the "Create new snapshot" button.
- **Playwright (CI):** `seedGeminiApiKey` before outline generation (otherwise `NO_API_KEY` blocks HTTP mocks); Writer textarea `data-testid="writer-studio-editor"`; export flow returns to Outline after saving key; character rename assertion uses `{ exact: true }` so "Braxton Hale Jr." does not satisfy "Braxton Hale".
- **Playwright (CI):** `flushWriterDebounce` after Writer fills (750ms DebouncedTextarea → Redux); snapshot restore re-selects manuscript section; import success uses exact toast copy (strict-mode vs markdown preview); delete assertion targets character card button counts.
- **Playwright (CI):** Removed flaky visual baseline `export-preview.png` from export E2E (text assertion retained); import persistence waits for debounced IndexedDB save, pre-checks Dashboard title, then reload + `#projectTitle`; Settings API key step skips fill when key already configured after `seedGeminiApiKey`; export flow opens **Appearance** before **Dark|Dunkel** (theme controls not mounted on AI tab).
- **Playwright (CI):** E2E helpers use `#writer-section-select` (avoids wrong combobox); native `<option>` assertions replaced with count/selectOption; snapshot panel uses `getByRole('heading')` so `/Snapshots/i` does not match empty-state copy; export flow navigates via **AI Writing Studio** label.
- **`aiProviderService` test:** Pre-existing test "throws for anthropic provider" asserted a stale `'placeholder response'` string. Replaced with "falls back to local AI" — mocks `localAiFacade.generateLocalText` via `vi.spyOn` and asserts the correct fallback text, testing the real behavior rather than an obsolete error message.

### Documentation

- **Corpus sync (2026-05-10):** **[`AUDIT.md`](AUDIT.md)** curated markdown inventory updated to **19** entries (`docs/BEST-PRACTICES.md`, `docs/Design-System.md`); **[`README.md`](README.md)** Documentation Hub adds **Design-System** row; **[`docs/CI.md`](docs/CI.md)** documents **`tests/e2e/a11y.spec.ts`** + Lighthouse accessibility assertion; **[`CONTRIBUTING.md`](CONTRIBUTING.md)** Accessibility section aligned with WCAG 2.2-oriented architecture; **[`.cursor/index.mdc`](.cursor/index.mdc)** links **Barrierefreiheit** paths; **[`docs/BEST-PRACTICES.md`](docs/BEST-PRACTICES.md)** cross-links **`docs/ACCESSIBILITY.md`**; **[`.github/copilot-instructions.md`](.github/copilot-instructions.md)** locale module count + A11y doc pointer.
- **README / CLAUDE / CONTRIBUTING / `.cursor/index.mdc` / `.github/copilot-instructions.md` / `docs/Design-System.md` / AUDIT:** Documented **Command Center** stack (registry, palette, executor context, transient store, keyboard layer), Settings search + JSON exchange, Help RAG-lite + `tryActionId` + tours, Tooltip/EmptyState/toast command actions, and feature flags **`enableProjectHealthScore`** / **`enableCrossProjectSearch`**.
- **`docs/DEPLOYMENT.md`** + root **`vercel.json`:** GitHub Pages and **Vercel** documented as equal static-SPA paths; privacy note for API keys (client-side only).
- **README / AUDIT / CLAUDE / copilot-instructions:** Hybrid-AI architecture; **i18n runtime bundles** (`public/locales/*/bundle.json`) must stay in sync via **`pnpm run i18n:bundle`** / **`i18n:check`** / **`predev`** — fixes missing-translation **key placeholders** in the UI after editing `locales/**/*.json`.
- **README / AUDIT:** CI vs local validation (typecheck, lint, i18n; defer heavy E2E to cloud CI); Gold-Standard audit section dated **2026-05-10**.
- **Complete curated markdown pass (16 `.md` sources incl. [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)):** explicit inventory and cross-links in **[`AUDIT.md`](AUDIT.md)**; **README** Documentation Hub includes deployment guide and **`.github/ACTIONS-OPTIMIZATIONS.md`**; **`docs/CI.md`** related-files table links the historical Actions doc; **`.github/copilot-instructions.md`** i18n bundle wording updated. References throughout: Playwright **[`tests/e2e/helpers.ts`](tests/e2e/helpers.ts)** (no `networkidle` under Vite), Version Control overlay / **Escape**, memoized **`selectCurrentBranchSnapshots`**. Generated paths (`tests/e2e/html-report/`, `.stryker-tmp/`) remain non-doc.

## [1.3.0] — 2026-05-08

### Added

- **Legacy IndexedDB migration:** Idempotent copy from monolithic `storycraft-db` into dual `storycraft-state-db` / `storycraft-data-db` (`services/dbMigration.ts`, Vitest + `fake-indexeddb` in `tests/unit/dbMigration.test.ts`).
- **Codex & Story Bible:** Feature flags `enableCodexAutoTracking` / `enableStoryBibleAdvanced`; advanced Codex extracts co-occurrence edges + consistency hints; Consistency Checker shows Story Bible panel when Codex data exists.
- **Scene visualization:** Manuscript inspector button generates a scene image via Gemini (`sceneVisualization` prompt) and stores `scene-{sectionId}` in image storage.
- **Local AI core:** Expanded `sanitizeForPrompt` (truncation + jailbreak-like filters); optional `@mlc-ai/web-llm` / `@xenova/transformers` dynamic imports in `@domain/ai-core`.
- **Quality:** Stryker config (`stryker.conf.json`), Playwright axe smoke test (`tests/e2e/a11y.spec.ts`), visual regression enabled (`tests/e2e/visual-regression.spec.ts`), Modal unit test (`tests/unit/Modal.test.tsx`).
- **Lint:** `pnpm run lint` uses Biome `--error-on-warnings`.

### Fixed

- **Redux listener middleware:** `getOriginalState()` is read **before** debounce delays in project/settings auto-save listeners (RTK requirement), eliminating `getOriginalState can only be called synchronously` errors during async effects.
- **IndexedDB Story Codex:** `CODEX_STORE` uses inline `keyPath: 'projectId'` — `saveStoryCodex` no longer passes an explicit key to `put()`; large payloads wrap `{ projectId, compressedUtf16 }` for LZ-compressed strings; `getStoryCodex` unwraps accordingly.
- **Vitest IDB mock:** fake `objectStore.put` derives the map key from `value.projectId` when the explicit key argument is omitted (matches real IndexedDB inline-key behavior).
- **Playwright:** CI runs **Chromium-only** projects; `snapshotPathTemplate` shares one baseline across OSes; visual regression uses stable load + screenshot timeout.
- **Stryker:** `thresholds.break` set to `null` until mutation kill-rate on targeted files improves (report still generated; CI mutation job remains `continue-on-error`).

### Changed

- **Dependencies:** Added `@axe-core/playwright`, `@stryker-mutator/*`; refreshed `@google/genai` where applicable.
- **Documentation:** README install/PWA/desktop CTA; AUDIT migration + accessibility notes.

## [1.2.0] — 2026-05-02

### Added

- **Spotlight onboarding tour:** `driver.js` + `services/spotlightTour.ts` — guided steps (nav, header / optional command palette, Settings); completion stored locally; entry points on Dashboard and Help.
- **Five UI locales:** French, Spanish, and Italian enabled alongside German and English (Settings, Welcome Portal, Command Palette); FR/ES/IT copy brought to parity with EN keys (native sidebar/portal/tour/settings strings where applicable).
- **i18n CI gate:** `pnpm run i18n:check` (`scripts/check-i18n-keys.mjs`) enforces identical translation keys across `en`/`de`/`fr`/`es`/`it`; runs in the quality job. Optional `--fix` fills missing keys from English.
- **Dashboard onboarding:** Dismissible “Quick tips” banner (sidebar, AI settings, auto-save / snapshots) stored per device via `localStorage`.
- **Tauri workflow:** [`.github/workflows/tauri-build.yml`](.github/workflows/tauri-build.yml) builds desktop bundles on `workflow_dispatch` and `v*` tags (Ubuntu/Windows/macOS artifacts); **on `v*` tags**, installers are attached to the matching **GitHub Release**. Documented in [`docs/TAURI-CI.md`](docs/TAURI-CI.md).
- **Welcome portal:** Localized demo project (outline + first chapter) loadable as in-app import; first-visit hint and CTA. `hasSavedData` now uses `storageService` so the welcome flow matches the active backend (browser IndexedDB or Tauri FS).
- **Storage contract module:** `StorageBackend` + `SaveProjectInput` (flat `StoryProject` or Redux `{ data }` / `{ present }` envelope) in `services/storageBackend.ts`; Tauri FS unwraps to flat JSON on disk.

### Fixed

- **Codex extraction:** `escapeRegExpLiteral()` wraps native `RegExp.escape` when present and falls back for runtimes without it (restores Vitest/jsdom compatibility for `extractStoryCodex`).
- **AI providers:** `generateText` and `streamText` now merge a standalone `AbortSignal` into `AIRequestOptions` for **OpenAI** and **Ollama**, matching cancellation behavior already relied upon for Gemini (`services/aiProviderService.ts`; tests in `tests/unit/aiProviderService.test.ts`).

### Changed

- **Lint / DX:** `pnpm run lint` is warning-free — driver.js spotlight popover uses higher CSS specificity instead of `!important`; template literals in `scripts/check-i18n-keys.mjs` and `tests/unit/ollamaService.test.ts`; `biome.json` overrides turn off `noConsole` for `scripts/**/*.mjs`, `services/logger.ts`, and `tests/**`. Release version **1.2.0** aligned in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`. CONTRIBUTING adds Windows Corepack/pnpm and Graphify setup; [`docs/graphify.md`](docs/graphify.md) troubleshooting notes Windows PATH.
- **Documentation:** [`README.md`](README.md) / [`CONTRIBUTING.md`](CONTRIBUTING.md) / [`CLAUDE.md`](CLAUDE.md) — five UI locales, spotlight tour, Tauri → GitHub Releases on tags; [`docs/CI.md`](docs/CI.md) + [`docs/TAURI-CI.md`](docs/TAURI-CI.md) aligned. Earlier: CI job ids, `.lighthouserc.cjs`, Node 22; [`.github/ACTIONS-OPTIMIZATIONS.md`](.github/ACTIONS-OPTIMIZATIONS.md) disclaimer; [`AUDIT.md`](AUDIT.md) follow-up **2026-05-02**.

### Refactored

- **StorageManager:** `saveProject` accepts `StoryProject` (not `unknown`).
- **projectSlice Decomposition**: Split monolithic `projectSlice.ts` (777 → 248 lines) by extracting all 14 AI thunks into per-domain files under `features/project/thunks/`: `characterThunks.ts`, `worldThunks.ts`, `outlineThunks.ts`, `writingThunks.ts`, `projectManagementThunks.ts`. Shared lazy service loaders + `buildAiOptions` extracted to `thunks/thunkUtils.ts`; entity adapters to `adapters.ts` to break circular deps. `projectSlice` re-exports everything for backward compatibility.

### Added

- **Tauri fileSystemService Parity** (5 of 6 gaps closed): Added retry logic (`retryFs()` with 2 retries + 500 ms backoff), LZ-String compression matching dbService algorithm (10 KB threshold, `\x00lz1\x00` prefix), numeric snapshot IDs with metadata envelope, `deleteImage()`, `hasSavedData()`, and auto-snapshot every 5 min (max 20, FIFO pruning) to `fileSystemService.ts`.
- **Tauri Story Codex + RAG Parity** (Gap 3): Implemented file-per-project storage for Story Codex (`projects/{id}/codex/codex.snap`) and RAG vectors (`projects/{id}/codex/vectors.snap`) in the Tauri FS backend. Extended `StorageBackend` interface and `StorageManager` proxy with 6 new methods. `codexService` and `useConsistencyCheckerView` now route through `storageService` instead of calling `dbService` directly.

### Added (Tests)

- Expanded unit test suite from ~80 to ~160+ tests across 12 new test files: `aiUtils` (20 tests), `projectSelectors` (15 tests), `logger` (6 tests), `communityTemplateService` (6 tests), `thunkUtils` (2 tests), `aiThunkUtils` (4 tests), `ollamaService` (12 tests), `aiProviderService` (17 tests), `storageService` (11 tests), `useApp` (9 tests), `usePWA` (9 tests), `useSpeechRecognition` (6 tests). Extended `writerSlice` (+8), `featureFlagsSlice` (+2), `projectSlice` (+5), `dbService` (+3).
- **Node 24 localStorage Polyfill**: Added in-memory `localStorage` mock in `tests/setup.ts` for full CI compatibility across Node LTS and current (Node 24) versions. Node 24 exposes a native `localStorage` without `.clear()`; the polyfill activates only when `.clear` is absent.
- **Vitest Config Hardening**: Added `testTimeout: 30000`, `maxWorkers: 1` (RAM-constrained environments), lowered coverage thresholds to 15%/10% for honest baselines. JUnit reporter output to `reports/junit.xml`.

### Changed

- **TypeScript 6.0 Adoption**: Enabled `stableTypeOrdering` compiler flag in `tsconfig.json` to ensure consistent type union ordering between TS 6.0 and the upcoming TS 7.0 Go-native compiler.
- **Native RegExp.escape()**: Replaced custom `escapeRegExp()` helper in `services/codexService.ts` with native `RegExp.escape()` from ES2025 (available in TS 6.0 without polyfill).

### Refactored

- **SettingsView Decomposition**: Split 2112-LOC monolith `components/SettingsView.tsx` into 8 focused section files under `components/settings/` (SettingsShared, AiProviderCard, SettingsModals, GeneralSections, EditorSections, AiSections, SystemSections, DataSection). Main component reduced to ~234 LOC.
- **Constants Split**: Split 506-LOC `constants.tsx` into `constants/icons.tsx` (SVG paths), `constants/defaults.ts` (STORY_TEMPLATES), and `constants/index.ts` (barrel). All 18 existing imports resolve via barrel.
- **Listener Separation**: Split combined auto-save listener in `listenerMiddleware.ts` into separate project and settings listeners to prevent full project serialization on theme toggle.
- **StorageBackend Interface**: Unified `StorageManager` backend typing — removed `typeof dbService` union, typed as `StorageBackend` with `as unknown as StorageBackend` casts. Fixed `listSnapshots()` return type from `string[]` to `ProjectSnapshot[]`.

### Fixed

- **HelpView Array Keys**: Replaced bare array index keys with prefixed keys (`code-${index}`, `t-${index}`, `b-${index}-${subIndex}`) and added biome-ignore comments for deterministic regex-split patterns.
- **Collaboration Awareness Validation**: Added runtime validation for remote peer awareness state (type checks for id/name/color, length limits) to prevent malicious data injection.
- **Lighthouse CI**: Changed `continue-on-error` from `true` to `false` for Lighthouse job in CI.
- **codexService Infinite Loop**: Replaced `while` + `exec()` loop with `for...of matchAll()` to prevent browser freeze on English manuscripts.
- **Modal Focus-Trap**: Consolidated cleanup into single function with early return for `!isOpen`.
- **FOUC Theme Init**: Added inline theme script in `<head>` reading from localStorage.
- **dbService Decrypt**: Added missing `await` before `decryptWithMigration()` in try/catch blocks.

### Security

- **CryptoKey**: Replaced reconstructible key derivation with `crypto.subtle.generateKey()` non-extractable CryptoKey.
- **CSP img-src**: Tightened from `https:` wildcard to `'self' data: blob:` only. Added `frame-ancestors 'none'` and `upgrade-insecure-requests`.
- **Import Validation**: Added Valibot schema validation for imported project JSON.

### Changed

- **AI Provider**: `testAIConnection('gemini')` now makes real API validation call. OpenAI non-gpt models throw descriptive error instead of silent downgrade. OpenAI stream loop checks `signal.aborted`.
- **Coverage Config**: Replaced curated file list with glob patterns for honest all-up coverage.
- **Community Templates**: Updated error messages to reflect local static asset source instead of GitHub API references.

### Maintenance (2026-04-18 Hardening Batch)

- **CI / Codecov**: Replaced deprecated `pnpm dlx codecov` upload flow with `codecov/codecov-action@v5` in `.github/workflows/ci.yml`.
- **CI / Failure Visibility**: Removed `continue-on-error` from the Storybook job so broken Storybook builds fail CI as expected.
- **CI / Lighthouse Behavior**: Kept Lighthouse job soft-fail semantics for budget misses while using `lhci autorun --assert.exitCode=0` to avoid false-red budget exits and still surface runtime crashes.
- **Security Process**: Added `.github/SECURITY.md` with supported versions table, private disclosure channels, and a default 90-day coordinated disclosure policy.
- **PWA Update UX**: Switched Service Worker update activation to explicit user consent. `SKIP_WAITING` is now sent only from the update toast action instead of auto-activation paths.
- **Service Worker Lifecycle**: Removed install-time `self.skipWaiting()` from `public/sw.js` to prevent forced activation during active writing sessions.
- **Collaboration Resilience**: Added `wss://signaling.yjs.dev` as a signaling fallback in `services/collaborationService.ts` to reduce single-point-of-failure risk.
- **CSP Alignment**: Extended `connect-src` in `index.html` for additional collaboration signaling endpoints (`wss://signaling.yjs.dev`, `wss://*.workers.dev`).
- **Owner Documentation**: Added collaboration failover and self-hosted signaling guidance (Cloudflare Worker path) to `README.md`.
- **Test Hardening**: Replaced the stub `settingsSlice` unit test with a comprehensive suite (29 tests, 331 LOC) covering all reducer actions and edge cases.
- **Theme Roundtrip Testability**: Exported `applyInitialTheme` from `features/settings/settingsSlice.ts` and added persisted-state roundtrip tests for `localStorage` + system-theme resolution.

### Fixed

- **Render-Blocking Fonts**: Replaced 3 render-blocking `@import url("https://fonts.googleapis.com/...")` in `index.css` with self-hosted `@fontsource/inter`, `@fontsource/jetbrains-mono`, `@fontsource/merriweather` (woff2). Fonts are now bundled by Vite, eliminating external network requests and improving First Contentful Paint.

### Security

- **CSP Tightening (Fonts)**: Removed `https://fonts.googleapis.com` from `style-src` and `connect-src`, removed `https://fonts.gstatic.com` from `font-src` and `connect-src` in both `index.html` and `src-tauri/tauri.conf.json`. Fonts are now served from `'self'` only.

### Changed

- **Service Worker**: Removed Google Fonts Cache-First fetch handler and `CACHE_FONTS` cache bucket from `public/sw.js` (no longer needed with self-hosted fonts).
- **Documentation Consolidation**: Merged `audit15april2026.md` into `AUDIT.md` as a collapsible baseline section. Moved completed tasks from `TODO.md` to `docs/history/completed-v1.1.md`. Cleaned up `TODO.md` (current sprint only) and `ROADMAP.md` (quarterly+) with cross-references.

### Removed

- `audit15april2026.md` (consolidated into `AUDIT.md`).
- Preconnect links to `fonts.googleapis.com` and `fonts.gstatic.com` from `index.html`.

### Added

- `@fontsource/inter`, `@fontsource/jetbrains-mono`, `@fontsource/merriweather` as dependencies for self-hosted font loading.
- `docs/history/completed-v1.1.md` archive for completed v1.1 sprint tasks.

### Fixed

- **Logger No-ops**: Fixed empty `debug()` and `info()` method bodies in `logger.ts` that silently discarded all debug/info log messages.
- **Community Templates CSP**: Replaced GitHub raw URL fetch in `communityTemplateService.ts` with local static asset (`public/community-templates/index.json`), eliminating CSP `connect-src` violations and enabling offline support.
- **Ollama Browser Guard**: Added `window.__TAURI__` check in `aiProviderService.ts` to prevent Ollama connection attempts in the browser (CSP blocks `localhost` in the deployed PWA). Added amber warning banner in SettingsView for non-desktop environments.
- **Tauri Ollama CSP**: Changed Tauri CSP `connect-src` from broad `http://localhost` to explicit `http://localhost:11434 http://127.0.0.1:11434` for Ollama API access.
- **Service Worker Double-Track**: Switched VitePWA from `generateSW` to `injectManifest` strategy, preventing conflicts with the custom `public/sw.js` service worker. Added `self.__WB_MANIFEST` injection point for precache manifest.
- **i18n Eager Loading**: Replaced 70 parallel fetch calls (14 modules × 5 languages) at boot with lazy single-bundle loading (2 fetches max: active language + EN fallback). Added `scripts/build-i18n.mjs` prebuild step to merge per-module JSON files into `public/locales/<lang>/bundle.json`.
- **modulePreload Optimization**: Converted all 14 AI thunks in `projectSlice.ts` from static imports to dynamic `import()` calls for `aiProviderService` and `geminiService`, keeping `@google/genai` out of the eager chunk graph. Added Vite `modulePreload.resolveDependencies` filter to skip preloading vendor chunks (`ai-vendor`, `export-vendor`, `data-vendor`, `collaboration-vendor`, `canvas-vendor`).

### Security

- **Tauri FS Scope**: Replaced unscoped `fs:allow-*` permissions in `src-tauri/capabilities/default.json` with `$APPDATA/**`-scoped entries, preventing filesystem access outside the application data directory.

### Added

- `settings.ai.ollamaBrowserNote` translation key in all 5 locale files (de, en, es, fr, it).
- `public/community-templates/index.json` static asset for offline community template loading.
- `scripts/build-i18n.mjs` build script for i18n bundle generation.
- `prebuild` npm script hook to auto-generate i18n bundles before production builds.

### Fixed

- **Critical**: Configured Tailwind CDN dark mode to use `selector` strategy with `.dark-theme` class. Previously, all `dark:` prefixed Tailwind classes responded to OS system preference instead of the in-app theme toggle, causing broken styling when OS and app theme diverged.
- **Light Mode Overlays**: Replaced all hardcoded `bg-black/40`, `bg-black/60`, `bg-gray-900/50` modal/drawer/panel backdrops with theme-aware `--overlay-backdrop` CSS custom property across Modal, Drawer, CommandPalette, Sidebar, CollaborationPanel, and VersionControlPanel.
- **Light Mode Card Overlays**: Fixed CharacterView and WorldView card gradient overlays (`via-black/40`) and hardcoded `text-white`/`text-gray-300` text to use theme-aware CSS custom properties.
- **Light Mode Glass Effects**: Replaced all `bg-white/5`, `bg-white/10`, `border-white/5`, `via-white/15` dark-mode-only glass morphism classes with theme-aware CSS custom properties (`--glass-bg`, `--glass-bg-hover`, `--glass-border`, `--glass-highlight`) across Input, Textarea, Select, Checkbox, Card, AddNewCard, Skeleton, Button, Header, Dashboard, WriterView, ExportView, SettingsView, HelpView, TemplateView, WorldView, ManuscriptView, and CommandPalette.
- **Light Mode Aurora**: Reduced aurora blob opacity from 0.25 to 0.08 in light mode to prevent visual noise on white backgrounds.
- **Light Mode Prose Links**: Fixed HelpView prose link color (`prose-a:text-indigo-400`) to use `prose-a:text-indigo-600 dark:prose-a:text-indigo-400` for proper contrast in both themes.
- **Light Mode Ring/Focus Indicators**: Replaced `ring-white/10`, `ring-black/5 dark:ring-white/5` with theme-aware `--glass-border` for consistent visibility in both themes.
- **Tauri Version Mismatch**: Aligned `src-tauri/tauri.conf.json` version from `1.0.0` to `1.1.1` (matching `package.json`).
- **Tauri Build Path**: Fixed `frontendDist` from `../build` to `../dist` to match Vite's default output directory (was breaking `tauri build`).
- **Hardcoded German String**: Replaced hardcoded `'EPUB-Export fehlgeschlagen: '` in ExportView with i18n key `export.error.epubFailed`.
- **Hardcoded EPUB Language**: Replaced hardcoded `lang: 'de'` in EPUB export with dynamic `language` from user settings.

### Security

- **CSP Tightening**: Removed overly broad `https://*.googleapis.com` wildcard from Tauri CSP `connect-src`, retaining only the specific `https://generativelanguage.googleapis.com` domain needed for Gemini API.

### Changed

- **Tauri Window Defaults**: Improved window configuration from 800×600 to 1280×800 with `minWidth: 800`, `minHeight: 600`, and `center: true` for better desktop UX.
- **Tauri Product Name**: Changed from `storycraft-studio` to `StoryCraft Studio` for proper branding in window title and system tray.

### Added

- New CSS custom properties for theme-aware glass/overlay effects: `--overlay-backdrop`, `--glass-bg`, `--glass-bg-hover`, `--glass-border`, `--glass-highlight`, `--card-gradient-overlay` with appropriate values for both dark and light themes.
- Added `export.error.epubFailed` translation key to all 5 locale files (de, en, es, fr, it).

## [1.1.1] — 2026-04-17

### Security

- Resolved all npm audit vulnerabilities: 0 high, 0 critical (was 4 high + 1 critical).
- Fixed `protobufjs` critical arbitrary code execution vulnerability (upgraded to ≥7.5.5).
- Resolved `serialize-javascript` RCE + DoS vulnerabilities via npm overrides for the `vite-plugin-pwa` → `workbox-build` → `@rollup/plugin-terser` chain.
- Guarded all unprotected `localStorage` accesses in `useApp.ts` with try/catch.
- Guarded all unprotected `sessionStorage` accesses in `usePWA.ts` and `CollaborationPanel.tsx`.
- Added missing Tauri capabilities: `fs:allow-read-dir`, `fs:allow-remove` (fixes runtime failures for `listProjects`, `deleteProject`, `deleteSnapshot`, `clearApiKey`).
- Removed type-unsafe references to non-existent `StoryProject.author`/`.description` in `fileSystemService.ts`.

### Added

- CI security audit job: `npm audit --audit-level=high` + `dependency-review-action` on PRs.
- CI Lighthouse job: performance budget assertions from `.lighthouserc.cjs` with artifact upload.
- CI Storybook job: automated build + artifact upload.
- Bundle analyzer: `rollup-plugin-visualizer` as opt-in devDep (`npm run analyze`).
- Shared AI utility module `services/aiUtils.ts`: `stripControlChars`, `sanitizePromptValue`, `sanitizePromptBlock`, `cleanPrompt`, `attachCause`, `stripJsonFences`.

### Changed

- CI pipeline order: security → quality → build → lighthouse/storybook → deploy.
- Reduced Vite `chunkSizeWarningLimit` from 900 KB to 600 KB for more informative dev warnings.

### Fixed

- Deduplicated 4 utility functions between `geminiService.ts` and `aiProviderService.ts`.
- Documented Tauri feature parity gaps as tracked tech debt in AUDIT.md.

## [1.1.0] — 2026-04-16

### Security

- Set restrictive Content Security Policy for Tauri desktop app (`src-tauri/tauri.conf.json`)
- Narrowed Tauri capabilities to granular permissions (fs read/write, dialog open/save, shell open)
- Fixed Tauri identifier from `com.tauri.dev` to `com.storycraft.studio`
- Synced Tauri version to `1.0.0` (was `0.1.0`)
- Added AbortController support to all 14 AI-calling async thunks in projectSlice
- Added signal parameter to `checkConsistency`, `analyzeAsCritic`, `detectPlotHoles` service functions
- Activated retry logic in geminiService (was defined but never called)
- Added PSK-based room isolation for P2P collaboration (SHA-256 room ID derivation)
- API key decrypt failures now return explicit `DECRYPT_FAILED` status with UI recovery flow

### Fixed

- Hardcoded `'en'` language in `useConsistencyCheckerView` and `useCriticView` hooks now dynamically reads from user settings
- Missing `src-tauri/target/` entry in `.gitignore`
- Removed duplicate empty `.prettierrc` file (`.prettierrc.json` is authoritative)
- Fixed 50+ Markdown lint errors in `README.md` (MD022, MD031, MD032, MD040, MD060)
- Removed `as any` type casts in `app/hooks.ts` (shallowEqual) and `app/store.ts` (preloadedState)
- Auto-save now validates state before writing to IndexedDB (null-check, 5MB size warning)

### Added

- Per-view error boundaries with `key={currentView}` auto-reset and "Reset View" button
- AbortController + cleanup in useConsistencyCheckerView and useCriticView hooks
- Generation history capped at 50 entries (FIFO) in writerSlice
- Room password input field in CollaborationPanel for PSK-based collaboration
- Decrypt failure warning banner in ApiKeySection with re-entry prompt
- `ROADMAP.md` with Ollama/Local-AI strategy, model comparison table, and feature roadmap
- `TODO.md` with prioritized task tracker
- Unit tests: geminiService, projectSlice, writerSlice, settingsSlice, dbService, listenerMiddleware, collaborationService (80 tests total)
- Coverage thresholds (50%) in vitest.config.ts
- Manual chunks for leaflet, konva, recharts in Vite build config

### Changed

- Redux logger middleware now opt-in via `localStorage.getItem('debugRedux')`
- CI pipeline: ESLint and typecheck switched from soft-fail to hard-fail mode
- ErrorBoundary component now accepts `onReset` callback prop
- `AUDIT.md` updated with resolution status for addressed findings
- Lazy-loaded `docx`/`jszip` export libraries and improved Vite manual chunk splitting with a higher `chunkSizeWarningLimit` for optimized production builds

## [1.0.0] — 2025-01-01

### Added

#### Core Application

- React 19 + TypeScript 5 (strict mode) single-page application
- Vite 6 build tooling with ES2022 target and manual chunk splitting
- Redux Toolkit 2.x state management with Redux-Undo (100-step history)
- Feature-sliced architecture (`project`, `settings`, `status`, `writer`, `versionControl`)
- Listener middleware for debounced auto-save to IndexedDB (1000ms)

#### Writing & Editing

- Three-panel manuscript editor with chapter navigator and project inspector
- Real-time `@character` and `#world` mention overlay with linking
- Scene board — kanban-style drag-and-drop visual story planning (DnD Kit)
- Voice dictation via Web Speech API with multi-language support
- Command palette (Ctrl+K / ⌘K) for keyboard-first navigation

#### AI Integration (Google Gemini API)

- 10 specialized AI writing tools: Continue, Improve, Change Tone, Dialogue, Brainstorm, Synopsis, Grammar & Style, Critic, Plot-Hole Detector, Consistency Checker
- AI outline generator with genre, pacing, and plot twist controls
- AI character profile generator with backstory, motivations, and personality traits
- AI character portrait generation in multiple styles (realistic, anime, cartoon, comic)
- AI world-building content generation with atmospheric ambiance images
- AI logline suggestions for project dashboard
- RAG-based consistency checker cross-referencing manuscript against character/world data
- Streaming AI responses with chunk-by-chunk rendering
- Multi-provider architecture (Gemini primary, OpenAI and Ollama support)

#### Story Structure & Planning

- Intelligent story template library (Three-Act, Hero's Journey, Save the Cat!, Fichtean Curve)
- Genre templates (Fantasy, Thriller, Horror, Romance, Space Opera, Dystopian)
- Community template system with GitHub-hosted template repository
- Interactive character relationship graph (force-directed visualization)

#### Data Management

- IndexedDB storage with LZ-String compression for payloads > 10KB
- AES-256-GCM encryption for API keys via Web Crypto API
- Version control with branch management and snapshot system
- Project import/export as JSON with image handling
- Auto-save with configurable debounce interval

#### Export Suite

- Markdown (`.md`) export
- Plain text (`.txt`) export
- PDF export with title page, configurable font and spacing (jsPDF)
- DOCX export (docx + jszip)
- EPUB 3.0 client-side generation (epubApiService)
- AI-generated synopsis for export

#### Collaboration

- P2P real-time editing via Yjs + WebRTC (no backend required)
- Awareness system for presence tracking
- Shared Y.Text documents for concurrent editing

#### Progressive Web App (PWA) v3.0

- Service Worker with versioned caches and smart caching strategies
- Cache-First for static assets, Stale-While-Revalidate for dynamic content
- NetworkOnly for AI API calls (never cached)
- Offline fallback page with branded UI
- Installable on desktop and mobile (iOS & Android)
- App shortcuts for quick access from home screen
- Background sync and periodic update support
- Web App Manifest v3 with share target and protocol handlers

#### Internationalization (i18n)

- 5 languages: German (complete), English (complete), French, Spanish, Italian (in progress)
- 14 modular translation files per language
- Custom React Context-based i18n system
- Language persistence via localStorage
- Document `lang` attribute synchronization

#### Accessibility

- WCAG 2.1 AA compliance
- Semantic HTML with comprehensive ARIA attributes
- Focus trapping in modals and drawers
- Keyboard navigation throughout
- Screen reader support with sr-only labels
- High contrast, reduced motion, and color-blind mode settings

#### Desktop Application

- Tauri 2 wrapper for native desktop distribution
- File system access via Tauri plugins
- Dialog and shell integration

#### Developer Experience

- ESLint 9 flat config with TypeScript, React, React Hooks, and jsx-a11y plugins
- Prettier formatting with pre-commit hooks (Husky + lint-staged)
- Vitest unit testing with jsdom environment
- Playwright E2E testing (Chromium + Firefox)
- Storybook component development environment
- GitHub Actions CI/CD pipeline (lint → typecheck → test → build → deploy)
- Automatic GitHub Pages deployment on push to main

### Security

- No hardcoded API keys — all keys encrypted at rest in IndexedDB
- Content Security Policy in index.html
- Local-first architecture — no data leaves the browser
- HTTPS-only external API communication
- Device-scoped encryption key derivation

[1.20.0]: https://github.com/qnbs/WorldScript-Studio/compare/v1.19.0...v1.20.0
[1.19.0]: https://github.com/qnbs/WorldScript-Studio/compare/v1.18.1...v1.19.0
[1.18.1]: https://github.com/qnbs/WorldScript-Studio/compare/v1.18.0...v1.18.1
[1.18.0]: https://github.com/qnbs/WorldScript-Studio/compare/v1.17.1...v1.18.0
[1.17.1]: https://github.com/qnbs/WorldScript-Studio/compare/v1.17.0...v1.17.1
[1.17.0]: https://github.com/qnbs/WorldScript-Studio/compare/v1.10.0...v1.17.0
[1.11.0]: https://github.com/qnbs/WorldScript-Studio/compare/v1.10.0...v1.11.0
[1.10.0]: https://github.com/qnbs/WorldScript-Studio/compare/v1.9.0...v1.10.0
[1.9.0]: https://github.com/qnbs/WorldScript-Studio/compare/v1.8.0...v1.9.0
[1.8.0]: https://github.com/qnbs/WorldScript-Studio/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/qnbs/WorldScript-Studio/compare/v1.6.0...v1.7.0
[1.6.2]: https://github.com/qnbs/WorldScript-Studio/compare/v1.6.1...v1.6.2
[1.6.1]: https://github.com/qnbs/WorldScript-Studio/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/qnbs/WorldScript-Studio/compare/v1.4.0...v1.6.0
[1.5.0]: https://github.com/qnbs/WorldScript-Studio/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/qnbs/WorldScript-Studio/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/qnbs/WorldScript-Studio/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/qnbs/WorldScript-Studio/compare/v1.0.0...v1.2.0
[1.1.1]: https://github.com/qnbs/WorldScript-Studio/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/qnbs/WorldScript-Studio/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/qnbs/WorldScript-Studio/releases/tag/v1.0.0
