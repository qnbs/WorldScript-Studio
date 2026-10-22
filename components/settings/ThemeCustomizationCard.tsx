import type { FC } from 'react';
import { useSettingsViewContext } from '../../contexts/SettingsViewContext';
import {
  contrastRatio,
  EMPTY_THEME_CUSTOMIZATION,
  hasThemeCustomization,
  MAX_CUSTOM_CSS_LENGTH,
  normalizeThemeCustomization,
  THEME_COLOR_KEYS,
  type ThemeColorKey,
  WCAG_AA_TEXT_CONTRAST,
} from '../../services/themeCustomization';
import type { ThemeCustomization } from '../../types';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { useResolvedThemeTokens } from './useResolvedThemeTokens';

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

// QNBS-v3 (#702): a background without a text color gets contrast-safe text at runtime, so only an explicit text color can be too faint.
function lowTextContrast(tc: ThemeCustomization, themeBackground: string): number | null {
  if (!tc.textColor) return null;
  const background = tc.backgroundColor || themeBackground;
  if (!background) return null;
  const ratio = contrastRatio({ foreground: tc.textColor, background });
  return ratio < WCAG_AA_TEXT_CONTRAST ? ratio : null;
}

/**
 * The stored record as edited: unknown fields and the stored CSS payload survive every color edit
 * (#702, preserve-first); only the CSS editor shows a string fallback for a non-string payload. A
 * malformed stored value is never spread; edits then start from the defaults.
 */
function editableThemeCustomization(stored: unknown): {
  record: ThemeCustomization;
  cssText: string;
} {
  const isRecord = typeof stored === 'object' && stored !== null && !Array.isArray(stored);
  const record = {
    ...EMPTY_THEME_CUSTOMIZATION,
    ...(isRecord ? stored : {}),
  } as ThemeCustomization;
  const css: unknown = record.customCss;
  return { record, cssText: typeof css === 'string' ? css : '' };
}

const TOKENS = Object.values(FIELDS).map((field) => field.token);

/** One decimal, rounded down, so a ratio just under 4.5:1 never reads as 4.5. */
export function formatContrastRatio(ratio: number): string {
  return (Math.floor(ratio * 10) / 10).toFixed(1);
}

export const ThemeCustomizationCard: FC = () => {
  const { t, settings, handleSettingChange } = useSettingsViewContext();
  const { record, cssText } = editableThemeCustomization(settings.themeCustomization);
  const colors = normalizeThemeCustomization(record);
  const update = (patch: Partial<ThemeCustomization>) =>
    handleSettingChange('themeCustomization', { ...record, ...patch });
  const resolved = useResolvedThemeTokens(
    TOKENS,
    JSON.stringify([
      settings.theme,
      settings.appearancePreset,
      settings.themeCustomization,
      settings.accessibility?.highContrast,
    ]),
  );
  const lowContrast = lowTextContrast(colors, resolved['--sc-surface-base'] ?? '');

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
                    value={colors[key] || resolved[field.token] || ''}
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
            {t('settings.appearance.contrastWarning', { ratio: formatContrastRatio(lowContrast) })}
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
            value={cssText}
            maxLength={MAX_CUSTOM_CSS_LENGTH}
            onChange={(e) => update({ customCss: e.target.value })}
            spellCheck={false}
            className="w-full h-32 p-3 rounded border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)] text-[var(--sc-text-primary)] font-mono text-sm"
          />
          <p className="text-xs text-right text-[var(--sc-text-muted)]">
            {cssText.length} / {MAX_CUSTOM_CSS_LENGTH}
          </p>
        </div>
        {hasThemeCustomization({ ...colors, customCss: cssText }) && (
          <Button variant="secondary" onClick={() => update({ ...EMPTY_THEME_CUSTOMIZATION })}>
            {t('settings.appearance.resetAllCustomization')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};
