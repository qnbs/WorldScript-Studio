import type { FC } from 'react';
import { useSettingsViewContext } from '../../contexts/SettingsViewContext';
import {
  contrastRatio,
  EMPTY_THEME_CUSTOMIZATION,
  hasThemeCustomization,
  isHexColor,
  MAX_CUSTOM_CSS_LENGTH,
  normalizeThemeCustomization,
  THEME_COLOR_KEYS,
  type ThemeColorKey,
  WCAG_AA_TEXT_CONTRAST,
} from '../../services/themeCustomization';
import type { ThemeCustomization } from '../../types';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader } from '../ui/Card';

const FIELDS: Record<ThemeColorKey, { id: string; label: string; hint: string; token: string }> = {
  primaryColor: {
    id: 'settings-primary-color',
    label: 'settings.appearance.primaryColor',
    hint: 'settings.appearance.primaryColorHint',
    token: '--sc-accent',
  },
  secondaryColor: {
    id: 'settings-secondary-color',
    label: 'settings.appearance.secondaryColor',
    hint: 'settings.appearance.secondaryColorHint',
    token: '--sc-text-secondary',
  },
  accentColor: {
    id: 'settings-accent-color',
    label: 'settings.appearance.accentColor',
    hint: 'settings.appearance.accentColorHint',
    token: '--nav-border-active',
  },
  backgroundColor: {
    id: 'settings-bg-color',
    label: 'settings.appearance.backgroundColor',
    hint: 'settings.appearance.backgroundColorHint',
    token: '--sc-surface-base',
  },
  textColor: {
    id: 'settings-text-color',
    label: 'settings.appearance.textColor',
    hint: 'settings.appearance.textColorHint',
    token: '--sc-text-primary',
  },
};

function rgbToHex(rgb: string): string {
  const channels = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb)?.slice(1, 4) ?? [];
  if (channels.length !== 3) return '';
  return `#${channels.map((c) => Number(c).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Current theme value of a token as #rrggbb, so an unset color input starts at what the user sees.
 * The browser resolves var()/color-mix() through a probe element; an unresolvable value yields ''
 * (the color input then shows its own default).
 */
function readTokenHex(token: string): string {
  const value = getComputedStyle(document.body).getPropertyValue(token).trim().toLowerCase();
  if (isHexColor(value)) return value;
  const probe = document.createElement('span');
  probe.style.color = `var(${token})`;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return rgbToHex(resolved);
}

// QNBS-v3 (#702): a background without a text color gets contrast-safe text at runtime, so only an explicit text color can be too faint.
function lowTextContrast(tc: ThemeCustomization): number | null {
  if (!tc.textColor) return null;
  const background = tc.backgroundColor || readTokenHex('--sc-surface-base');
  const ratio = contrastRatio({ foreground: tc.textColor, background });
  return ratio < WCAG_AA_TEXT_CONTRAST ? ratio : null;
}

/**
 * The stored record as edited: unknown fields and the raw CSS source survive every edit (#702,
 * preserve-first). A malformed stored value is never spread; edits then start from the defaults.
 */
function editableThemeCustomization(stored: unknown): ThemeCustomization {
  const isRecord = typeof stored === 'object' && stored !== null && !Array.isArray(stored);
  const raw = { ...EMPTY_THEME_CUSTOMIZATION, ...(isRecord ? stored : {}) };
  return typeof raw.customCss === 'string' ? raw : { ...raw, customCss: '' };
}

export const ThemeCustomizationCard: FC = () => {
  const { t, settings, handleSettingChange } = useSettingsViewContext();
  const raw = editableThemeCustomization(settings.themeCustomization);
  const colors = normalizeThemeCustomization(raw);
  const update = (patch: Partial<ThemeCustomization>) =>
    handleSettingChange('themeCustomization', { ...raw, ...patch });
  const lowContrast = lowTextContrast(colors);

  return (
    <Card>
      <CardHeader>
        <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
          {t('settings.appearance.customization')}
        </h2>
        <p className="text-xs text-[var(--sc-text-muted)]">
          {t('settings.appearance.customizationHint')}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {THEME_COLOR_KEYS.map((key) => {
            const field = FIELDS[key];
            const label = t(field.label);
            return (
              <div key={key}>
                <label
                  htmlFor={field.id}
                  className="text-sm font-medium text-[var(--sc-text-secondary)] block"
                >
                  {label}
                </label>
                <p id={`${field.id}-hint`} className="text-xs text-[var(--sc-text-muted)] mb-2">
                  {t(field.hint)}
                </p>
                <div className="flex items-center gap-2">
                  <input
                    id={field.id}
                    type="color"
                    aria-describedby={`${field.id}-hint`}
                    value={colors[key] || readTokenHex(field.token)}
                    onChange={(e) => update({ [key]: e.target.value })}
                    className="h-10 w-16 rounded border border-[var(--sc-border-subtle)]"
                  />
                  <span className="text-xs font-mono text-[var(--sc-text-secondary)]">
                    {colors[key] || t('settings.appearance.themeDefault')}
                  </span>
                  {colors[key] && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => update({ [key]: '' })}
                      aria-label={t('settings.appearance.resetColorAria', { name: label })}
                    >
                      {t('settings.appearance.resetColor')}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {lowContrast !== null && (
          <p
            role="status"
            className="text-sm rounded p-2 bg-[var(--sc-warning-bg)] text-[var(--sc-warning-fg)]"
          >
            {t('settings.appearance.contrastWarning', { ratio: lowContrast.toFixed(1) })}
          </p>
        )}
        <div>
          <label
            htmlFor="settings-custom-css"
            className="text-sm font-medium text-[var(--sc-text-secondary)] block"
          >
            {t('settings.appearance.customCss')}
          </label>
          <p id="settings-custom-css-hint" className="text-xs text-[var(--sc-text-muted)] mb-2">
            {t('settings.appearance.customCssHint')}
          </p>
          <textarea
            id="settings-custom-css"
            aria-describedby="settings-custom-css-hint"
            value={raw.customCss}
            maxLength={MAX_CUSTOM_CSS_LENGTH}
            onChange={(e) => update({ customCss: e.target.value })}
            placeholder="/* Custom CSS */"
            spellCheck={false}
            className="w-full h-32 p-3 rounded border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)] text-[var(--sc-text-primary)] font-mono text-sm"
          />
          <p className="text-xs text-right text-[var(--sc-text-muted)]">
            {raw.customCss.length} / {MAX_CUSTOM_CSS_LENGTH}
          </p>
        </div>
        {hasThemeCustomization({ ...colors, customCss: raw.customCss }) && (
          <Button variant="secondary" onClick={() => update({ ...EMPTY_THEME_CUSTOMIZATION })}>
            {t('settings.appearance.resetAllCustomization')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};
