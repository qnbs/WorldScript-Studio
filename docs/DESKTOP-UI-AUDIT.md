# Desktop (Tauri) UI/UX Audit & Remediation Tracker

> Living catalog for the Tauri desktop UI/UX remediation (plan: "WorldScript Studio — Tauri Desktop
> UI/UX Deep Audit"). Phase D0 seeds this from **code-derived** root causes; the **visual pass**
> (run the Tauri build, screenshot matrix) confirms specifics and fills the `Status` column. Phases
> D1–D4 consume it. Native window chrome is retained; all three desktop OSes are in scope.

## How desktop styling is scoped

`services/tauriRuntime.ts:applyDesktopRuntimeFlags()` (called once on mount in `App.tsx`) adds
`body.is-desktop` and `data-os ∈ {windows,macos,linux}`. All desktop overrides live in the
**`.is-desktop` CSS layer** at the bottom of `index.css` — the PWA DOM/markup and web build stay
untouched. Use `body.is-desktop` (and `.is-desktop[data-os="…"]` for per-engine quirks). Never the
`dark:` Tailwind prefix; use `--sc-*` tokens. New tokens must keep `pnpm run token:audit` green.

## Visual pass — screenshot matrix (human, per OS)

Run `pnpm run tauri:dev` on each OS (and `pnpm run dev` in a browser for fast layout iteration).
Capture each **view** across:

- **Window width:** 800 (min) · 1280 (default) · 1920 · 2560
- **Theme:** light · dark · sepia
- **DPI / scale:** 100% · 150% · 200%
- **Engine:** Windows WebView2 · macOS WebKit · Linux WebKitGTK

Views to cover: Dashboard · Manuscript (editor + Navigator + Inspector) · Plot Board · Mind Map ·
Character / Character Graph · World · Settings (all sections) · Help · Export · Command Palette ·
ProForge dashboard/review · onboarding/empty/loading/error states.

For each defect found, add a row below (severity · area · file · fix · status).

## Code-derived findings (D0 — to confirm in the visual pass)

| # | Severity | Area | Finding | Root cause (file) | Planned fix (phase) | Status |
|---|----------|------|---------|-------------------|---------------------|--------|
| C-1 | High | Layout | Content-light views stretch edge-to-edge on wide windows; no app-shell/content max-width | `App.tsx` `<main>` (no `max-w`); `Dashboard`/`SettingsView` grids uncapped | `PageContainer` width primitive (D1) | ☐ confirm |
| C-2 | High | Typography | Help long-form text runs full window width (unbounded measure) | `components/HelpView.tsx` `prose max-w-none` | reading-width cap (D1) | ☐ confirm |
| C-3 | Medium | Typography | Fluid type capped at 1280px while line length grows unbounded without a content cap | `index.css:46-54` (`--text-sc-*` clamp ceiling) + no max-width | width cap (D1) + optional fluid tuning (D2) | ☐ confirm |
| C-4 | Medium | Layout | Only one layout breakpoint (`md` 768); no large-desktop (`xl`/`2xl`) density refinement | global responsive strategy | desktop density tokens/grids (D2) | ☐ confirm |
| C-5 | Medium | Component | Touch-target chunkiness under a mouse (`min-h-[44px]`/`min-w-[44px]` in desktop-visible toolbars; 44 files) | inline Tailwind across toolbars | pointer-aware `min-h-touch` utility (D3) | ☐ confirm |
| C-6 | Medium | Tauri/perf | Heavy glassmorphism (`backdrop-blur` in 47 files + `--glass-*`) — GPU cost on WebView2/WebKitGTK | `--glass-*` tokens; pervasive `backdrop-blur-*` | reduce blur on desktop / `reduceTransparency` setting (D4) | ☐ confirm |
| C-7 | Medium | Tauri/menu | Native menu is only File (Export/Settings/Quit) + Help — no Edit/View/Window | `src-tauri/src/lib.rs:install_app_menu` | enrich native menu (D4) | ☐ confirm |
| C-8 | Med | Tauri/engine | Per-engine CSS quirks (scrollbars, `backdrop-filter`, `100dvh`, focus ring) unverified across WebView2/WebKit/WebKitGTK | global CSS | per-OS `.is-desktop[data-os]` fixes (D4) | ☐ confirm |
| C-9 | Low/Med | Visual | `transition-all duration-500` on panels may feel sluggish on desktop | panel components | lighten transitions on desktop (D3) | ☐ confirm |
| C-10 | Low | Tauri/HiDPI | Canvas crispness on HiDPI — verify `CharacterGraphView`/force-graph + Plot Board/Mind Map | `components/CharacterGraphView.tsx` (only `devicePixelRatio` user) | verify; fix if blurry (D0/D4) | ☐ confirm |

### Confirmed-good (no action)

- Manuscript editor self-caps reading width (`components/manuscript/ManuscriptEditor.tsx`
  `max-w-3xl`/`max-w-4xl mx-auto`) — keep; **do not** wrap in `PageContainer`.
- Window always renders the desktop layout (minWidth 800 ≥ `md` 768) — no accidental mobile UI.
- `tauri-plugin-window-state` restores window size/position.
- Native window chrome retained by decision (no custom titlebar).

## Visual-pass findings (filled by the human screenshot pass)

> Add rows as `V-n | severity | area | finding | file | fix | status`. These feed D1–D4 prioritization.

_(none yet — pending the screenshot matrix)_
