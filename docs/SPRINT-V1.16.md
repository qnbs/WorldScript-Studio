# Sprint v1.16 — Design System Completion (DS-1 / DS-2 / SB-1 / HK-4)

**Date:** 2026-05-22  
**Scope:** Complete the UI/UX audit design-system sprint items — token migration, dark: elimination, Storybook coverage, displayName housekeeping  
**Version bump:** package.json stays at 1.10.0 (no feature additions; pure refactor/cleanup sprint)

---

## Summary

All remaining P0/P1/P2 items from the comprehensive UI/UX Design System Audit Plan completed. The codebase is now fully migrated off `dark:` Tailwind prefixes and undefined bridge CSS variables.

---

## Changes

### DS-2 — `dark:` prefix elimination (100% complete)

Zero `dark:` prefix violations remain in any `className` string across the entire codebase.

**Files fixed this sprint:**
- `components/mind-map/MindMapListPanel.tsx` — full rewrite (stone/violet → sc-* tokens, shared `inputClass`)
- `components/mind-map/MindMapToolbar.tsx` — 5 violations
- `components/mind-map/MindMapCanvas.tsx` — 3 violations
- `components/mind-map/MindMapNodeEditor.tsx` — 25+ violations
- `components/SceneTimelinePanel.tsx` — 1 violation
- `components/ui/AddNewCard.tsx` — 1 violation
- `components/TemplateView.tsx` — 1 violation
- `components/WorldView.tsx` — 5 violations
- `components/HelpView.tsx` — 1 violation (prose-a link color)
- `components/settings/ShortcutsSection.tsx` — 1 violation
- `components/settings/DataSection.tsx` — 1 violation
- `components/WelcomePortal.tsx` — 4 violations
- `components/OutlineGeneratorView.tsx` — 3 violations
- `components/ObjectsView.tsx` — 12 violations (alpha-bg pattern for categorical badge colors)
- `components/ui/Toast.tsx` — 3 violations (alpha-bg pattern for toast type variants)
- `constants/sections.tsx` — 43 violations (section identity badge colors)

**Pattern used:**
- `dark:text-X-400` → `text-[var(--sc-text-primary)]` or mid-range `text-X-500`
- `dark:bg-X-900` → `bg-[var(--sc-surface-base)]` or `bg-X-500/15`
- Categorical colors: `bg-X-500/15 text-X-600` (alpha-bg pattern works on all themes)

### DS-1 — Undefined bridge variable sweep

Replaced all undefined CSS variables (silently rendering as transparent/invisible):

| Old var | Replacement |
|---------|-------------|
| `var(--background-hover)` | `var(--sc-surface-overlay)` |
| `var(--background-elevated)` | `var(--sc-surface-raised)` |
| `var(--background-selected)` | `var(--sc-accent)/10` |
| `var(--foreground-on-interactive)` | `white` |
| `var(--foreground-tertiary)` | `var(--sc-text-muted)` |
| `var(--background-primary)` (App.tsx) | `var(--sc-surface-base)` |
| `var(--foreground-primary)` (App.tsx) | `var(--sc-text-primary)` |
| `var(--background-interactive)` (App.tsx) | `var(--sc-accent)` |
| `var(--text-primary/secondary/muted)` (ObjectsView) | `var(--sc-text-primary/secondary/muted)` |

**Files fixed:** App.tsx, BookPreviewView.tsx, ProgressTrackerView.tsx, CommentsPanel.tsx, ReferencePanelView.tsx, SceneRevisionPanel.tsx, ConnectionToolbar.tsx, SubplotPanel.tsx, TensionCurvePanel.tsx, AccessibilitySection.tsx, CollaborationSection.tsx, ObjectsView.tsx

**Intentionally kept (defined in index.css per-theme):**
- `--background-gradient-overlay-start` — card image gradient overlays
- `--card-gradient-overlay` — card image gradient overlays
- `--border-interactive` — alias to `--sc-border-focus` / `--sc-accent` (theme-dependent)
- `--nav-*` — standalone nav token family
- `--glass-*` — standalone glassmorphism token family

### SB-1 — Storybook coverage (5 missing stories added)

| Story | Variants |
|-------|----------|
| `DebouncedInput.stories.tsx` | Default, FastDebounce, Disabled |
| `DebouncedTextarea.stories.tsx` | Default, FastDebounce, Disabled |
| `Textarea.stories.tsx` | Default, WithContent, Disabled, Tall |
| `PWAComponents.stories.tsx` | OfflineIndicator, InstallBanner (presentational) |
| `SectionIcon.stories.tsx` | Default, AllSections grid, Sizes (xs–xl) |

All UI atom components now have Storybook stories. The `StorybookWrapper` (Redux + I18n providers) is used for atoms with Redux dependencies.

### HK-4 — displayName additions

- `components/ui/ErrorBoundary.tsx` → `ErrorBoundary.displayName = 'ErrorBoundary'`
- `components/ui/ViewErrorBoundary.tsx` → `ViewErrorBoundary.displayName = 'ViewErrorBoundary'`

---

## Validation

```bash
pnpm run lint           # 0 errors, 0 warnings
pnpm run i18n:check     # 1952 keys × 5 locales ✅
pnpm run typecheck      # 0 errors ✅
```

**Results:** lint ✅ · i18n ✅ (1952 keys × 5 locales) · typecheck ✅

---

## DS-5 Readiness

The bridge variable block in `index.css` can now be safely removed (DS-5) after one production verification cycle. Remaining entries in the bridge block are either:
- `--border-interactive` — semantically needed (theme-dependent interactive border)
- `--nav-*` — standalone nav tokens (not bridge vars)
- `--glass-*` — standalone glassmorphism tokens (not bridge vars)
- `--background-gradient-overlay-start` / `--card-gradient-overlay` — intentional per-theme gradient vars
