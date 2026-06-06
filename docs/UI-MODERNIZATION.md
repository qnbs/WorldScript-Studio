# UI Modernization Guide — StoryCraft Studio

**Version:** v1.20.0 (2026-06-06)
**Status:** Phase 1 Complete — LanguageSelector, RadioGroup, Tabs

## Overview

This document tracks the ongoing UI/UX modernization effort to bring StoryCraft Studio to 2026 premium standards. All components follow the established design token system (`--sc-*`) and maintain WCAG 2.2 AA+ accessibility compliance.

## Design Principles

### 1. Semantic Design Tokens
All colors, spacing, typography, and effects use the `--sc-*` token system defined in `index.css`. Never use hardcoded colors or Tailwind `dark:` prefix.

### 2. RTL & CJK Support
- All interactive components support `[dir="rtl"]` layouts
- CJK fonts use `--font-ui-cjk` and `--font-editor-cjk` tokens
- Text direction is handled via CSS logical properties (`ps-`, `pe-` instead of `pl-`, `pr-`)

### 3. Reduced Motion
Components respect `prefers-reduced-motion` media query. Animations are disabled or reduced when the user prefers reduced motion.

### 4. Keyboard Navigation
All interactive components follow WAI-ARIA patterns:
- `role="listbox"` for dropdowns
- `role="radiogroup"` for radio groups
- `role="tablist"` for tabs
- Arrow key navigation where appropriate

## New Components

### LanguageSelector

A modern combobox for language selection with search functionality.

**Features:**
- Search/filter languages by name or code
- Flag emojis for visual recognition
- Beta language indicators (β marker)
- Compact and full variants
- RTL-aware positioning
- Keyboard navigation (Escape to close, Arrow keys for navigation)

**Usage:**
```tsx
import { LanguageSelector } from './ui/LanguageSelector';

// Compact variant (for header)
<LanguageSelector
  value={language}
  onChange={setLanguage}
  variant="compact"
/>

// Full variant (for settings)
<LanguageSelector
  value={language}
  onChange={setLanguage}
  variant="full"
/>
```

### RadioGroup

Accessible radio button group with proper ARIA attributes.

**Features:**
- Individual option descriptions
- Disabled state support
- Focus ring with design tokens
- Glassmorphism styling

**Usage:**
```tsx
import { RadioGroup } from './ui/RadioGroup';

<RadioGroup
  options={[
    { value: 'focused', label: 'Focused', description: 'Precise, deterministic output' },
    { value: 'balanced', label: 'Balanced', description: 'Creative yet consistent' },
    { value: 'imaginative', label: 'Imaginative', description: 'Highly creative output' },
  ]}
  value={aiCreativity}
  onChange={setAiCreativity}
/>
```

### Tabs

WAI-ARIA compliant tab component with multiple variants.

**Features:**
- Three variants: `default`, `pills`, `underline`
- Proper `role="tablist"` and `role="tab"` attributes
- TabPanel component for content association
- Keyboard navigation support

**Usage:**
```tsx
import { Tabs, TabPanel } from './ui/Tabs';

const [activeTab, setActiveTab] = useState('general');

<Tabs
  tabs={[
    { id: 'general', label: 'General' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'advanced', label: 'Advanced' },
  ]}
  activeTab={activeTab}
  onChange={setActiveTab}
  variant="underline"
/>

<TabPanel tabId="general" activeTab={activeTab}>
  {/* General settings content */}
</TabPanel>
```

## Phase Roadmap

| Phase | Components | Status |
|-------|------------|--------|
| Phase 1 | LanguageSelector, RadioGroup, Tabs | ✅ Complete |
| Phase 2 | Select (Combobox), Dropdown Menu, Action Menu | Pending |
| Phase 3 | Manuscript Editor, Plot Board, Scene Board | Pending |
| Phase 4 | Dashboard, Progress Tracker, Export View | Pending |
| Phase 5 | Loading States, Empty States, Error States | Pending |

## Migration Guide

### Replacing Native Selects

Replace `<select>` elements with the new `LanguageSelector` or upcoming `Combobox` component:

```tsx
// Before
<select onChange={(e) => setLanguage(e.target.value as Language)}>
  <option value="en">English</option>
  <option value="de">Deutsch</option>
</select>

// After
<LanguageSelector value={language} onChange={setLanguage} />
```

### Replacing Checkbox Toggles

For boolean settings, use `ToggleSwitch` from `SettingsShared`:

```tsx
// Before
<input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />

// After
<ToggleSwitch checked={enabled} onChange={setEnabled} label="Enable feature" />
```

## Testing

All components include:
- Unit tests in `tests/unit/components/ui/`
- Storybook stories in `stories/ui/`
- Accessibility tests via `@storybook/addon-a11y`

Run tests:
```bash
pnpm run test:run tests/unit/components/ui/
pnpm run storybook
```

## Contributing

When adding new UI components:
1. Use semantic design tokens (`--sc-*`)
2. Follow the existing file naming convention (`PascalCase.tsx`)
3. Include JSDoc comments for props
4. Add stories to Storybook
5. Ensure RTL compatibility
6. Test with reduced motion preference
