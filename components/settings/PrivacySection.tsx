import type { FC } from 'react';
import { useSettingsViewContext } from '../../contexts/SettingsViewContext';
import { desktopPlatform } from '../../services/desktopPlatform';
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
    migrationProgress,
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
              hint={t('settings.privacy.analyticsHint')}
              checked={settings.privacy.analyticsEnabled}
              onChange={(v) =>
                handleSettingChange('privacy', { ...settings.privacy, analyticsEnabled: v })
              }
            />
            <ToggleSwitch
              label={t('settings.privacy.dataEncryption')}
              // QNBS-v3: Locked is still encrypted; showing it as off invited an unsafe disable path.
              checked={featureFlags.enableIdbAtRestEncryption}
              hint={encEnabled ? t('settings.privacy.encryptionWarning') : undefined}
              disabled={encEnabled}
              onChange={(v) => {
                if (v) setPassphraseModal('set');
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
              label={t('settings.privacy.euDataResidency')}
              hint={t('settings.privacy.euDataResidencyHint')}
              checked={settings.privacy.euDataResidency}
              onChange={(v) =>
                handleSettingChange('privacy', { ...settings.privacy, euDataResidency: v })
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
          {desktopPlatform.runtime.isDesktop && (
            <p className="text-sm text-[var(--sc-warning-fg)]" role="note">
              {t('settings.privacy.encryptionDesktopScope')}
            </p>
          )}

          <p className={`text-sm font-medium ${statusColor}`}>{statusText}</p>

          <div className="flex flex-wrap gap-3">
            {!encEnabled && (
              <Button variant="primary" onClick={() => setPassphraseModal('set')}>
                {t('settings.privacy.encryptionSetAction')}
              </Button>
            )}
            {encEnabled && !encryptionReady && (
              // QNBS-v3: 'unlock' re-derives in-memory key from passphrase; 'set' would overwrite existing encryption sentinel
              <Button variant="primary" onClick={() => setPassphraseModal('unlock')}>
                {t('settings.privacy.encryptionUnlockAction')}
              </Button>
            )}
            {encEnabled && encryptionReady && (
              <>
                {/* QNBS-v3: Lock Session clears the in-memory key without disabling encryption — user must re-enter passphrase on next access. */}
                <Button variant="secondary" onClick={handleLockSession}>
                  {t('settings.privacy.encryptionLockAction')}
                </Button>
                {/* QNBS-v3: both require an unlocked session key — clearIdbPassphrase/rotateIdbPassphrase re-migrate every protected store before touching the sentinel. */}
                <Button variant="secondary" onClick={() => setPassphraseModal('rotate')}>
                  {t('settings.privacy.encryptionChangeAction')}
                </Button>
                <Button variant="danger" onClick={() => setPassphraseModal('disable')}>
                  {t('settings.privacy.encryptionDisableAction')}
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
          progress={migrationProgress}
        />
      )}
    </div>
  );
};
