import type { FC } from 'react';
import { useSettingsViewContext } from '../../contexts/SettingsViewContext';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { PassphraseModal } from './PassphraseModal';
import { ToggleSwitch } from './SettingsShared';

export const PrivacySection: FC = () => {
  const {
    t,
    settings,
    handleSettingChange,
    featureFlags,
    encryptionReady,
    passphraseModal,
    setPassphraseModal,
    handlePassphraseConfirm,
    handleLockSession,
  } = useSettingsViewContext();

  const encEnabled = featureFlags.enableIdbAtRestEncryption;

  const statusText = !encEnabled
    ? t('settings.privacy.encryptionDisabledStatus')
    : encryptionReady
      ? t('settings.privacy.encryptionActiveStatus')
      : t('settings.privacy.encryptionLockedStatus');

  const statusColor = !encEnabled
    ? 'text-[var(--sc-text-secondary)]'
    : encryptionReady
      ? 'text-[var(--sc-success-fg)]'
      : 'text-[var(--sc-warning-fg)]';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
            {t('settings.privacy.title')}
          </h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ToggleSwitch
              label={t('settings.privacy.analyticsEnabled')}
              checked={settings.privacy.analyticsEnabled}
              onChange={(v) =>
                handleSettingChange('privacy', { ...settings.privacy, analyticsEnabled: v })
              }
            />
            <ToggleSwitch
              label={t('settings.privacy.crashReporting')}
              checked={settings.privacy.crashReporting}
              onChange={(v) =>
                handleSettingChange('privacy', { ...settings.privacy, crashReporting: v })
              }
            />
            <ToggleSwitch
              label={t('settings.privacy.dataEncryption')}
              checked={featureFlags.enableIdbAtRestEncryption && encryptionReady}
              onChange={(v) => {
                // QNBS-v3: dataEncryption is now a read-through of the actual IDB at-rest encryption
                // state. Toggling it opens the passphrase modal to set up or disable encryption.
                if (v) setPassphraseModal('set');
                else setPassphraseModal('disable');
              }}
            />
            <ToggleSwitch
              label={t('settings.privacy.localStorageOnly')}
              checked={settings.privacy.localStorageOnly}
              onChange={(v) =>
                handleSettingChange('privacy', { ...settings.privacy, localStorageOnly: v })
              }
            />
            <ToggleSwitch
              label={t('settings.privacy.shareUsageData')}
              checked={settings.privacy.shareUsageData}
              onChange={(v) =>
                handleSettingChange('privacy', { ...settings.privacy, shareUsageData: v })
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* IDB at-rest encryption card (B-1) */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold text-[var(--sc-text-primary)]">
            {t('settings.privacy.encryptionEnabled')}
          </h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-[var(--sc-text-secondary)]">
            {t('settings.privacy.encryptionSetup')}
          </p>

          <p className={`text-sm font-medium ${statusColor}`}>{statusText}</p>

          <div className="flex flex-wrap gap-3">
            {!encEnabled && (
              <Button variant="primary" onClick={() => setPassphraseModal('set')}>
                {t('settings.privacy.encryptionSetAction')}
              </Button>
            )}
            {encEnabled && !encryptionReady && (
              <Button variant="primary" onClick={() => setPassphraseModal('set')}>
                {t('settings.privacy.encryptionUnlockAction')}
              </Button>
            )}
            {encEnabled && encryptionReady && (
              <>
                <Button variant="secondary" onClick={() => setPassphraseModal('change')}>
                  {t('settings.privacy.encryptionChangeAction')}
                </Button>
                <Button variant="danger" onClick={() => setPassphraseModal('disable')}>
                  {t('settings.privacy.encryptionDisableAction')}
                </Button>
                {/* QNBS-v3: Lock Session clears the in-memory key without disabling encryption —
                    user must re-enter passphrase on next access. */}
                <Button variant="secondary" onClick={handleLockSession}>
                  {t('settings.privacy.encryptionLockAction')}
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {passphraseModal !== 'closed' && (
        <PassphraseModal
          mode={passphraseModal}
          onClose={() => setPassphraseModal('closed')}
          onConfirm={handlePassphraseConfirm}
        />
      )}
    </div>
  );
};
