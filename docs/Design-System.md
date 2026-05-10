# StoryCraft Studio Design System

This document describes semantic tokens, theme presets, and migration notes introduced for the premium UI foundation. Runtime styling is **CSS-first** (`index.css`); TypeScript mirrors live in `@domain/ui` (`packages/ui/src/tokens.ts`).

## Principles

- **Semantic naming**: Prefer `--sc-*` variables (`surface`, `text`, `accent`) over raw hex in components.
- **Legacy bridge**: Historical variables (`--background-primary`, `--foreground-primary`, …) map to semantic tokens so existing screens keep working during incremental migration.
- **Accessibility**: High contrast uses `.accessibility-high-contrast` on `body`; reduced motion uses `.storycraft-reduced-motion` plus `prefers-reduced-motion`.
- **Internationalization**: User-facing labels for presets live in locale bundles (`settings.appearance.preset*`).

## Semantic tokens (overview)

| Category | Examples |
|----------|-----------|
| Surface | `--sc-surface-base`, `--sc-surface-raised`, `--sc-surface-overlay` |
| Text | `--sc-text-primary`, `--sc-text-secondary`, `--sc-text-muted` |
| Accent | `--sc-accent`, `--sc-accent-hover`, `--sc-accent-subtle`, `--sc-accent-glow` |
| Border / focus | `--sc-border-subtle`, `--sc-border-strong`, `--sc-ring-focus` |
| Semantic status | `--sc-danger-*`, `--sc-success-*`, `--sc-warning-*`, `--sc-info-*` |
| Elevation | `--sc-shadow-xs` … `--sc-shadow-xl` |
| Motion | `--sc-duration-fast`, `--sc-duration-normal`, `--sc-ease-standard`, `--sc-ease-emphasized` |
| Typography | `--font-ui`, `--font-editor`, `--font-mono`, `--sc-prose-measure` |
| Z-index scale | `--sc-z-docked` … `--sc-z-toast` (see CSS comments) |

## Theme mechanics

1. **Light/dark**: `body` classes `.light-theme` / `.dark-theme` (from `settings.theme` and `App.tsx`).
2. **Creative palettes**: `settings.appearancePreset` adds one of `appearance-sepia`, `appearance-fantasy`, `appearance-romance`, or none for default.
3. **User customization**: Existing `themeCustomization` hex fields and custom CSS remain supported.

## Tailwind v4

`index.css` defines `@theme inline { … }` so utilities such as `bg-sc-accent`, `rounded-sc-lg`, `duration-sc-fast`, and `ease-sc-emphasized` resolve to the same variables. The optional `packages/ui/tailwind-preset.ts` mirrors names for package consumers.

## Component migration checklist

When touching UI:

1. Replace one-off hex with `var(--sc-…)` or legacy vars still bridged.
2. Prefer focus rings `ring-[var(--ring-focus)]` (maps to `--sc-ring-focus`).
3. Respect `prefers-reduced-motion` (global CSS already tones down aurora and `.animate-in`).
4. Do not log or expose secrets; design changes stay presentation-only.

## Storybook

Global decorators switch `body` theme classes; use the toolbar **Theme** and **Appearance** for regression checks of primitives.

## Helper UI primitives

Shared productivity components (use semantic tokens above):

| Primitive | Path | Notes |
|-----------|------|--------|
| **Tooltip** | `components/ui/Tooltip.tsx` | Prefer over raw `title` for keyboard-accessible hints; delay and positioning props. |
| **EmptyState** | `components/ui/EmptyState.tsx` | Primary/secondary actions + optional help links for manuscript and other views. |
| **Toast** | `components/ui/Toast.tsx` + `features/status/statusSlice.ts` | Optional **`actionLabel`** + **`commandId`** — action dispatches via command registry when present. |

Command Palette and Settings Shortcuts should reuse the same focus-ring and motion tokens (`--sc-ring-focus`, reduced-motion classes).
