# StoryCraft Studio — Engineering & Content Best Practices

Single reference for maintainers: architecture touchpoints, content rules, security/privacy framing, testing expectations, and CI gates. Product docs and tutorials remain in the [Documentation Hub](../README.md#documentation-hub).

## Architecture (short)

- **State:** Redux Toolkit feature slices + listener middleware for side effects; transient UI in Zustand (`app/transientUiStore.ts`).
- **Persistence:** `storageService` → `StorageBackend` (`IndexedDB` web / filesystem Tauri). No second ad-hoc storage for secrets.
- **AI:** `geminiService` / `aiProviderService` — all network AI goes through these adapters.
- **Commands:** `services/commands/` registry; execution via `CommandExecutorProvider` / `runCommandById`.
- **i18n:** Source modules under `locales/<lang>/*.json`; runtime bundles `public/locales/<lang>/bundle.json` rebuilt by `pnpm run i18n:bundle` / `i18n:check`.

## Content & copy

- **Tone:** Supportive, precise; AI as co-pilot, not ghostwriter. Match formality to each locale (de/fr/es/it/en).
- **Glossary (UI):** Use consistently across Settings, Help, and Command Palette:
  - **Manuscript** — Haupttext / Kapitelansicht
  - **Outline** — Handlungsgliederung / Plot-Skeleton (not mixed with “template structure” in user-facing text without context)
  - **Template** — vorgegebene Erzählstruktur
  - **Codex / Story Bible** — projektinterne Referenz (wie in App benannt)
  - **Snapshot** — zeitpunktbezogene Sicherung des Projekts
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

## Testing & coverage

- **Unit/integration:** Vitest; global coverage thresholds in `vitest.config.ts` are a regression floor.
- **Risk-hotspots** (aim for focused tests when touching): `dbService`, `dbMigration`, `aiProviderService`, project import/export, `storageService` / `storageBackend`.
- **E2E:** Playwright (CI-only `CI=true`); a11y smoke with axe (see `tests/e2e/a11y.spec.ts`).
- **Mutation:** Stryker job is informational until thresholds are tightened.

## CI gates (local parity)

- `pnpm run lint` — Biome, warnings fail.
- `pnpm run typecheck`
- `pnpm run i18n:check` — keys + bundle build + `content:guard`
- `pnpm run test:run` / `pnpm run test:coverage`
- `pnpm run build` + `pnpm run bundle:budget`

## RTL & future locales

- No RTL locale shipped yet. When adding one: set `dir` on the document root from language metadata, mirror spacing in new CSS using logical properties where possible, and audit modals/scroll locks.

## Plugin-style extensibility (lightweight)

- Prefer stable seams over a full plugin runtime: `featureFlags`, commands registry, `storageService`, and documented JSON contracts (settings exchange, project export).
