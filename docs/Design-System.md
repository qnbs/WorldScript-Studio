# StoryCraft Studio Design System

Runtime styling is **CSS-first** (`index.css`); TypeScript mirrors live in `@domain/ui` (`packages/ui/src/tokens.ts`).

## Principles

- **Single vocabulary**: Use `--sc-*` variables exclusively. The bridge aliases below are **DEPRECATED** — kept only in `index.css` for backward compatibility until DS-5 removes them.
- **No `dark:` Tailwind prefix in components**: StoryCraft uses body-class theming (`.light-theme` / `.dark-theme`), not Tailwind's `dark:` media-query mechanism. Using `dark:` bypasses appearance presets and will break sepia/fantasy/romance themes.
- **Accessibility**: High contrast uses `.accessibility-high-contrast` on `body`; reduced motion uses `.storycraft-reduced-motion` plus `prefers-reduced-motion`.
- **Internationalization**: User-facing labels for presets live in locale bundles (`settings.appearance.preset*`).

## Semantic tokens (overview)

| Category | Tokens |
|----------|--------|
| Surface | `--sc-surface-base`, `--sc-surface-raised`, `--sc-surface-overlay`, `--sc-surface-inverse` |
| Text | `--sc-text-primary`, `--sc-text-secondary`, `--sc-text-muted`, `--sc-text-on-accent` |
| Accent | `--sc-accent`, `--sc-accent-hover`, `--sc-accent-subtle`, `--sc-accent-glow` |
| Border / focus | `--sc-border-subtle`, `--sc-border-strong`, `--sc-ring-focus` |
| Semantic status | `--sc-danger-{bg,fg,border}`, `--sc-success-{bg,fg}`, `--sc-warning-{bg,fg}`, `--sc-info-{bg,fg}` |
| Data-viz | `--sc-data-1` … `--sc-data-8` (categorical), `--sc-heat-0` … `--sc-heat-4` (sequential) |
| Elevation | `--sc-shadow-xs` … `--sc-shadow-xl` |
| Motion | `--sc-duration-fast` (150ms), `--sc-duration-normal` (280ms), `--sc-ease-standard`, `--sc-ease-emphasized` |
| Typography | `--font-ui`, `--font-editor`, `--font-mono`, `--sc-prose-measure` |
| Z-index | `--sc-z-docked` (10) → `--sc-z-sticky` (100) → `--sc-z-command` (150) → `--sc-z-modal` (200) → `--sc-z-toast` (300) |
| Glass | `--glass-bg`, `--glass-bg-hover`, `--glass-border`, `--glass-highlight` |
| Navigation | `--nav-background-hover`, `--nav-background-active`, `--nav-text-active`, `--nav-border-active` |

### Contrast compliance (WCAG 2.2)

`--sc-text-muted` is set per-theme for AAA compliance:
- **Dark** (`#94a3b8`): 7.97:1 on `--sc-surface-base` — AAA ✓
- **Light** (`#4b5563`): 7.39:1 on `#ffffff` — AAA ✓

## ⚠️ DEPRECATED bridge variables

These aliases still exist in `index.css` but must not be used in new or modified component code.

| **Old (DEPRECATED)** | **Replacement** |
|----------------------|-----------------|
| `var(--background-primary)` | `var(--sc-surface-base)` |
| `var(--background-secondary)` | `var(--sc-surface-raised)` |
| `var(--background-tertiary)` | `var(--sc-surface-overlay)` |
| `var(--background-interactive)` | `var(--sc-accent)` |
| `var(--background-interactive-hover)` | `var(--sc-accent-hover)` |
| `var(--background-interactive-subtle)` | `var(--sc-accent-subtle)` |
| `var(--foreground-primary)` | `var(--sc-text-primary)` |
| `var(--foreground-secondary)` | `var(--sc-text-secondary)` |
| `var(--foreground-muted)` | `var(--sc-text-muted)` |
| `var(--foreground-interactive)` | `var(--sc-text-on-accent)` |
| `var(--border-primary)` | `var(--sc-border-subtle)` |
| `var(--border-highlight)` | `var(--sc-border-strong)` |
| `var(--ring-focus)` | `var(--sc-ring-focus)` |
| `var(--color-accent)` | `var(--sc-accent)` |

> **Migration status (DS-1, DS-2, DS-3 — June 2026):** All status-color occurrences in `components/` have been migrated to `--sc-*` tokens. Data-viz colors (`TYPE_COLORS`, `STATUS_META`) now use `--sc-data-*` and `--sc-heat-*` tokens. The bridge block in `index.css` will be removed in DS-5 after production verification.

## Theme mechanics

1. **Light/dark**: `body` classes `.light-theme` / `.dark-theme` (from `settings.theme` and `App.tsx`).
2. **Creative palettes**: `settings.appearancePreset` adds one of `appearance-sepia`, `appearance-fantasy`, `appearance-romance`, or none for default.
3. **Accessibility presets**: `settings.accessibility` drives body classes — see `features/settings/accessibilitySchema.ts` for all 5 presets.

## Tailwind v4

`index.css` defines `@theme inline { … }` so utilities such as `bg-sc-surface-base`, `bg-sc-accent`, `rounded-sc-lg`, `duration-sc-fast`, and `ease-sc-emphasized` resolve to the same variables. The optional `packages/ui/tailwind-preset.ts` mirrors names for package consumers.

**Logical CSS properties (RTL prep):** Use `ps-`/`pe-` instead of `pl-`/`pr-`, and `start-`/`end-` instead of `left-`/`right-` in UI atom components (`Modal`, `Drawer`, `Toast`, `Sidebar`). Tailwind v4 supports these natively.

## Component authoring rules

1. **Use `--sc-*` tokens only** — never raw hex, never the deprecated bridge vars above.
2. **Never use `dark:` Tailwind prefix** — it bypasses the body-class theme system.
3. **No `bg-white` / `bg-slate-*` / `text-gray-*` in component code** — always a semantic token.
4. **Focus rings**: `focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)]` — never `ring-blue-500` or `ring-indigo-500`.
5. **Transitions**: Use `duration-sc-fast` (150ms) for state changes, `duration-sc-normal` (280ms) for enter/exit.
6. **Respect `prefers-reduced-motion`** — global CSS handles aurora/animate-in; for custom animations check `settings.accessibility.reducedMotion`.
7. **Status colors**: Use `--sc-danger-*`, `--sc-success-*`, `--sc-warning-*` — not hardcoded red/green/yellow.

## Storybook

Stories live in `stories/`. Global decorators (`withTheme`, `withAppearance`) switch `body` theme classes.

**Toolbar states to test every story against:**
- Theme: Dark / Light
- Appearance: Default / Sepia / Fantasy / Romance

The `@storybook/addon-a11y` addon runs axe-core per story — all stories must pass with no serious violations.

**Coverage status:** 23 of 24 UI atoms have stories (see SB-Phase 1 in the audit plan for the remaining 1).

## Helper UI primitives

| Primitive | Path | Notes |
|-----------|------|--------|
| **Button** | `components/ui/Button.tsx` | `variant`: primary/secondary/danger/ghost/outline; `size`: sm/default/lg |
| **Card** | `components/ui/Card.tsx` | `as="button"` for interactive cards; glass-morphism with specular highlight |
| **Modal** | `components/ui/Modal.tsx` | Focus trap via `useFocusTrap`; `size`: default/lg/xl |
| **Drawer** | `components/ui/Drawer.tsx` | `position`: left/right; focus trap + Escape close |
| **BottomSheet** | `components/ui/BottomSheet.tsx` | Mobile only; drag-to-dismiss (30% threshold); focus trap |
| **Toast** | `components/ui/Toast.tsx` | `type`: success/error/info; optional `actionLabel` + `commandId` |
| **Tooltip** | `components/ui/Tooltip.tsx` | `label` + optional `shortcut`; prefer over raw `title` |
| **EmptyState** | `components/ui/EmptyState.tsx` | Primary/secondary actions + optional icon slot |
| **Skeleton** | `components/ui/Skeleton.tsx` | Loading placeholder; use before data arrives (not a generic spinner) |
| **ViewErrorBoundary** | `components/ui/ViewErrorBoundary.tsx` | Wraps every lazy view; retry + live-region announce |
| **Input** | `components/ui/Input.tsx` | Text input with optional voice dictation button; glass-morphism styling |
| **Select** | `components/ui/Select.tsx` | Custom accessible dropdown with `role="listbox"`; replaces native `<select>` |
| **LanguageSelector** | `components/ui/LanguageSelector.tsx` | Language picker with search, flags, beta indicators; uses Select pattern |
