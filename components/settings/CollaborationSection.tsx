import type { FC } from 'react';
import { useSettingsViewContext } from '../../contexts/SettingsViewContext';
import { DEFAULT_WEBRTC_SIGNALING_URLS } from '../../services/collaborationService';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Textarea } from '../ui/Textarea';

export const CollaborationSection: FC = () => {
  const { t, settings, handleSettingChange } = useSettingsViewContext();
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
            {t('settings.collaboration.title')}
          </h2>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* QNBS-v3: Security warning always shown so users understand public-relay implications before configuring signaling URLs */}
          <div
            role="alert"
            aria-live="polite"
            className="p-3 rounded-sc-md bg-[var(--sc-warning-bg)] border border-[var(--sc-warning-border)] text-sm text-[var(--sc-warning-fg)] space-y-1"
          >
            <p className="font-semibold">{t('collab.securityWarning')}</p>
            <p>{t('collab.securityWarningDetail')}</p>
          </div>
          <div>
            <label
              htmlFor="settings-webrtc-signaling-urls"
              className="text-sm font-medium text-[var(--sc-text-secondary)] mb-2 block"
            >
              {t('settings.collaboration.webrtcSignalingUrls')}
            </label>
            <Textarea
              id="settings-webrtc-signaling-urls"
              className="min-h-[5.5rem] font-mono text-sm"
              value={settings.collaboration.webrtcSignalingUrls.join('\n')}
              onChange={(e) => {
                const lines = e.target.value
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean);
                handleSettingChange('collaboration', {
                  ...settings.collaboration,
                  webrtcSignalingUrls:
                    lines.length > 0 ? lines : [...DEFAULT_WEBRTC_SIGNALING_URLS],
                });
              }}
              placeholder={t('settings.collaboration.webrtcSignalingUrlsPlaceholder')}
              aria-describedby="settings-webrtc-signaling-help"
            />
            <p
              id="settings-webrtc-signaling-help"
              className="mt-1 text-xs text-[var(--sc-text-muted)]"
            >
              {t('settings.collaboration.webrtcSignalingUrlsHelp')}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
