# Accessibility (WorldScript Studio)

Maintainer reference: where accessibility is anchored in the app and how we verify it.

## Architecture

- **Live regions:** `LiveRegionProvider` / `useAnnounce()` in [`contexts/LiveRegionContext.tsx`](../contexts/LiveRegionContext.tsx). View transitions are announced with the translated page title (not internal view keys).
- **Focus trapping:** `useFocusTrap()` in [`hooks/useFocusTrap.ts`](../hooks/useFocusTrap.ts) — used by Modal and Command Palette.
- **Settings hub:** Settings → Accessibility — presets and `liveRegionVerbosity`; persisted via Redux, validated with Zod in [`features/settings/accessibilitySchema.ts`](../features/settings/accessibilitySchema.ts).
- **WCAG standard:** WCAG 2.2 AA. Lighthouse CI gate: `minScore: 0.95` (error level — blocks CI).

## Component ARIA Patterns

### Global
| Component | Pattern |
|-----------|---------|
| Command Palette | `role="combobox"` + `role="listbox"` (ARIA combobox pattern) |
| Modal | Focus trap + `role="dialog"` + `aria-modal="true"` |
| Toast | `role="status"` or `role="alert"` depending on urgency |
| Navigation tabs | `role="tablist"` / `role="tab"` / `role="tabpanel"` |
| Skip link | `#main-content` anchor at top of `App.tsx` |
| Select | `role="listbox"` on dropdown + `role="option"` on items + `aria-haspopup="listbox"` + `aria-expanded` on trigger button |
| LanguageSelector | Same as Select + search input with `aria-label` for filtering |

### v1.6 Additions (Plot-Board v2, Reference Panel, Progress Tracker)
| Component | Pattern |
|-----------|---------|
| `PlotCanvas` | `role="application"` + `aria-label` + keyboard shortcuts documented in tooltip |
| `ConnectionLayer` SVG | `role="img"` on `<svg>` + `aria-label` listing connection count; per-connection `<path>` with `role="button"` + `tabIndex={0}` + `onKeyDown` (Enter/Space to select) |
| `TensionCurvePanel` SVG | `role="img"` on container SVG + `aria-label` with data summary for screen readers |
| `ProgressTrackerView` charts | `role="img"` on VelocityChart and Heatmap SVGs + `aria-label` with human-readable summary (e.g., "30-day writing velocity: peak 1 200 words on May 15") |
| Session elapsed timer | `role="timer"` + `aria-label` on the `<p>` element (supports `aria-label` per spec) |
| `CommentsPanel` | `role="list"` on comment list, `role="listitem"` per comment, `aria-label` on reply inputs |
| `ReferencePanelView` | `role="complementary"` on panel, `aria-label` from i18n; tab bar uses ARIA tablist/tab/tabpanel |
| `BookPreviewView` | `role="article"` per section (semantic HTML already), `aria-live="off"` on container |
| `SubplotPanel` | Color picker `<input type="color">` labelled via `aria-label` |
| Download-progress modal | `role="progressbar"` + `aria-valuenow` / `aria-valuemin` / `aria-valuemax` (WCAG 2.2) |
| `SceneBoardView` display-mode selector | `role="toolbar"` + `aria-label` — **not** `role="tablist"`; the buttons use `aria-pressed` (toggle button pattern), which is incompatible with `role="tab"` semantics |
| `ActSwimlane` DnD list | `<ul>` + `<li>` — DnD kit adds `role="button"` to the card `<div>`; wrapping in `<li>` satisfies the axe `list` rule (ul must contain only li children) |

## Manual Checks

- **Keyboard:** Skip-link (`App`), Command Palette (Ctrl/Cmd+K), all primary dialogs (focus stays trapped, Escape closes where expected), Plot Board mode tabs, session start/stop (Ctrl+Shift+S).
- **Screen reader sample:** Navigate between views, open/close palette, Accessibility hub in Settings, start a writing session in Progress Tracker, add a subplot in Plot Board.
- **High contrast:** Apply `.accessibility-high-contrast` class (Settings → Accessibility) — verify SVG charts and connection lines remain visible.

## Automated Checks

- **Playwright:** [`tests/e2e/a11y.spec.ts`](../tests/e2e/a11y.spec.ts) — axe-core; **critical and serious violations (including `color-contrast`) must be zero** — the test filters by `impact === 'serious' || impact === 'critical'` and fails on any match. WCAG AA minimum ratio: 4.5:1 for normal text, 3:1 for large text. Always use design tokens (`--sc-text-primary`, `--sc-text-on-accent`, `--sc-accent`, etc.) — never hardcoded Tailwind colors like `bg-indigo-600` which may not meet contrast thresholds. Use Storybook `addon-a11y` for component-level contrast audits during development.
- **Lighthouse CI:** [`.lighthouserc.cjs`](../.lighthouserc.cjs) — Accessibility category at **`error`** level `minScore: 0.95` — blocks CI on regression.
- **Storybook:** Dev-dependency `@storybook/addon-a11y` — use the A11y tab after `pnpm run storybook`.
- **Biome:** `a11y/*` lint rules run on every commit via pre-commit hook; warnings fail CI.

## i18n

All new user-visible accessibility strings live under `locales/*/…` and are synced to `public/locales/` by `pnpm run i18n:check` / the bundle build step. ARIA labels that use dynamic data (e.g., chart summaries) are constructed in the component using `t('key', { count })` pattern.
