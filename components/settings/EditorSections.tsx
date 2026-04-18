import type React from 'react';
import type { FC } from 'react';
import { useSettingsViewContext } from '../../contexts/SettingsViewContext';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { ToggleSwitch } from './SettingsShared';

export const EditorSection: FC = () => {
  const { t, settings, handleSettingChange } = useSettingsViewContext();

  const getFontFamily = () => {
    if (settings.editorFont === 'custom' && settings.customFont) {
      return settings.customFont.name;
    }
    return settings.editorFont;
  };
  const previewStyle = {
    fontFamily: getFontFamily(),
    fontSize: `${settings.fontSize}px`,
    lineHeight: settings.lineSpacing,
    '--paragraph-spacing': `${settings.paragraphSpacing * 0.5}rem`,
    textIndent: settings.indentFirstLine ? '2em' : '0',
  } as React.CSSProperties;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
            {t('settings.editor.title')}
          </h2>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <label
              htmlFor="font-family-select"
              className="text-sm font-medium text-[var(--foreground-secondary)]"
            >
              {t('settings.editor.fontFamily')}
            </label>
            <Select
              id="font-family-select"
              value={settings.editorFont}
              onChange={(e) => handleSettingChange('editorFont', e.target.value)}
            >
              <option value="serif">{t('settings.font.serif')}</option>
              <option value="sans-serif">{t('settings.font.sans')}</option>
              <option value="monospace">{t('settings.font.mono')}</option>
              <option value="custom">{t('settings.font.custom')}</option>
            </Select>
          </div>
          {settings.editorFont === 'custom' && (
            <div className="space-y-4 p-4 border border-[var(--border-primary)] rounded-lg">
              <h4 className="font-semibold text-[var(--foreground-primary)]">
                {t('settings.editor.customFont')}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  placeholder={t('settings.editor.customFontName')}
                  value={settings.customFont?.name || ''}
                  onChange={(e) =>
                    handleSettingChange('customFont', {
                      name: e.target.value,
                      url: settings.customFont?.url || '',
                      format: settings.customFont?.format || 'woff2',
                    })
                  }
                />
                <Select
                  value={settings.customFont?.format || 'woff2'}
                  onChange={(e) =>
                    handleSettingChange('customFont', {
                      name: settings.customFont?.name || '',
                      url: settings.customFont?.url || '',
                      format: e.target.value as 'woff' | 'woff2' | 'ttf' | 'otf',
                    })
                  }
                >
                  <option value="woff">WOFF</option>
                  <option value="woff2">WOFF2</option>
                  <option value="ttf">TTF</option>
                  <option value="otf">OTF</option>
                </Select>
              </div>
              <Input
                placeholder={t('settings.editor.customFontUrl')}
                value={settings.customFont?.url || ''}
                onChange={(e) =>
                  handleSettingChange('customFont', {
                    name: settings.customFont?.name || '',
                    url: e.target.value,
                    format: settings.customFont?.format || 'woff2',
                  })
                }
              />
            </div>
          )}
          <div className="space-y-2">
            <label
              htmlFor="font-size-input"
              className="flex justify-between text-sm font-medium text-[var(--foreground-secondary)]"
            >
              <span>{t('settings.editor.fontSize')}</span>
              <span>{settings.fontSize}px</span>
            </label>
            <input
              id="font-size-input"
              type="range"
              min="12"
              max="24"
              value={settings.fontSize}
              onChange={(e) => handleSettingChange('fontSize', e.target.value)}
              className="w-full"
            />
          </div>
          <div className="space-y-2">
            <label
              htmlFor="line-height-input"
              className="flex justify-between text-sm font-medium text-[var(--foreground-secondary)]"
            >
              <span>{t('settings.editor.lineHeight')}</span>
              <span>{settings.lineSpacing}</span>
            </label>
            <input
              id="line-height-input"
              type="range"
              min="1.2"
              max="2.2"
              step="0.1"
              value={settings.lineSpacing}
              onChange={(e) => handleSettingChange('lineSpacing', e.target.value)}
              className="w-full"
            />
          </div>
          <div className="space-y-2">
            <label
              htmlFor="p-spacing-input"
              className="flex justify-between text-sm font-medium text-[var(--foreground-secondary)]"
            >
              <span>{t('settings.editor.paragraphSpacing')}</span>
              <span>{settings.paragraphSpacing.toFixed(1)}</span>
            </label>
            <input
              id="p-spacing-input"
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={settings.paragraphSpacing}
              onChange={(e) => handleSettingChange('paragraphSpacing', e.target.value)}
              className="w-full"
            />
          </div>
          <ToggleSwitch
            label={t('settings.editor.indentFirstLine')}
            checked={settings.indentFirstLine}
            onChange={(v) => handleSettingChange('indentFirstLine', v)}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold text-[var(--foreground-primary)]">
            {t('settings.editor.previewTitle')}
          </h3>
        </CardHeader>
        <CardContent>
          <div
            style={previewStyle}
            className="p-4 bg-[var(--glass-bg)] rounded-md border border-[var(--border-primary)] max-h-48 overflow-y-auto text-[var(--foreground-primary)]"
          >
            <p className="[&&]:my-0 [&&]:mb-[var(--paragraph-spacing)]">
              {t('settings.editor.previewText1')}
            </p>
            <p className="[&&]:my-0">{t('settings.editor.previewText2')}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export const AdvancedEditorSection: FC = () => {
  const { t, settings, handleSettingChange } = useSettingsViewContext();
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
            {t('settings.advancedEditor.title')}
          </h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ToggleSwitch
              label={t('settings.advancedEditor.autoComplete')}
              checked={settings.advancedEditor.autoComplete}
              onChange={(v) =>
                handleSettingChange('advancedEditor', {
                  ...settings.advancedEditor,
                  autoComplete: v,
                })
              }
            />
            <ToggleSwitch
              label={t('settings.advancedEditor.spellCheck')}
              checked={settings.advancedEditor.spellCheck}
              onChange={(v) =>
                handleSettingChange('advancedEditor', {
                  ...settings.advancedEditor,
                  spellCheck: v,
                })
              }
            />
            <ToggleSwitch
              label={t('settings.advancedEditor.grammarCheck')}
              checked={settings.advancedEditor.grammarCheck}
              onChange={(v) =>
                handleSettingChange('advancedEditor', {
                  ...settings.advancedEditor,
                  grammarCheck: v,
                })
              }
            />
            <ToggleSwitch
              label={t('settings.advancedEditor.wordCount')}
              checked={settings.advancedEditor.wordCount}
              onChange={(v) =>
                handleSettingChange('advancedEditor', {
                  ...settings.advancedEditor,
                  wordCount: v,
                })
              }
            />
            <ToggleSwitch
              label={t('settings.advancedEditor.readingTime')}
              checked={settings.advancedEditor.readingTime}
              onChange={(v) =>
                handleSettingChange('advancedEditor', {
                  ...settings.advancedEditor,
                  readingTime: v,
                })
              }
            />
            <ToggleSwitch
              label={t('settings.advancedEditor.writingStats')}
              checked={settings.advancedEditor.writingStats}
              onChange={(v) =>
                handleSettingChange('advancedEditor', {
                  ...settings.advancedEditor,
                  writingStats: v,
                })
              }
            />
          </div>
          <div className="border-t border-[var(--border-primary)] pt-4">
            <h3 className="text-lg font-semibold text-[var(--foreground-primary)] mb-4">
              {t('settings.advancedEditor.focusModes')}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ToggleSwitch
                label={t('settings.advancedEditor.distractionFree')}
                checked={settings.advancedEditor.distractionFree}
                onChange={(v) =>
                  handleSettingChange('advancedEditor', {
                    ...settings.advancedEditor,
                    distractionFree: v,
                  })
                }
              />
              <ToggleSwitch
                label={t('settings.advancedEditor.typewriterMode')}
                checked={settings.advancedEditor.typewriterMode}
                onChange={(v) =>
                  handleSettingChange('advancedEditor', {
                    ...settings.advancedEditor,
                    typewriterMode: v,
                  })
                }
              />
              <ToggleSwitch
                label={t('settings.advancedEditor.zenMode')}
                checked={settings.advancedEditor.zenMode}
                onChange={(v) =>
                  handleSettingChange('advancedEditor', {
                    ...settings.advancedEditor,
                    zenMode: v,
                  })
                }
              />
              <ToggleSwitch
                label={t('settings.advancedEditor.focusMode')}
                checked={settings.advancedEditor.focusMode}
                onChange={(v) =>
                  handleSettingChange('advancedEditor', {
                    ...settings.advancedEditor,
                    focusMode: v,
                  })
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
