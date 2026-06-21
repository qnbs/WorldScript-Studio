import type { FC, ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { useAppDispatch } from '../../app/hooks';
import { useSettingsViewContext } from '../../contexts/SettingsViewContext';
import {
  FEATURE_CATALOG,
  FEATURE_TIER_ORDER,
  type FeatureCatalogEntry,
} from '../../features/featureCatalog';
import {
  defaultFeatureFlagsState,
  type FeatureFlagsState,
  featureFlagsActions,
} from '../../features/featureFlags/featureFlagsSlice';
import { resolveFlagAvailability } from '../../features/featureFlags/flagDependencies';
import { isTauriRuntime } from '../../services/tauriRuntime';
import { Badge, type BadgeVariant } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';
import { ToggleSwitch } from './SettingsShared';

// QNBS-v3: drive the maturity badge from FEATURE_CATALOG (single source of truth) rather than a
// hand-maintained list — stub/experimental → "Experimental", beta → "Beta", stable/unlisted → none.
const MATURITY_TO_BADGE: Record<string, BadgeVariant | undefined> = {
  experimental: 'experimental',
  stub: 'experimental',
  beta: 'beta',
  stable: undefined,
};

// QNBS-v3: enableIdbAtRestEncryption is intentionally NOT shown here — toggling it without the
// passphrase setup flow would lock users out. Its dedicated UI lives in Settings → Privacy
// (PrivacySection.tsx). Everything else in the catalog is user-toggleable here (22 flags).
const HIDDEN_FLAGS: ReadonlySet<keyof FeatureFlagsState> = new Set(['enableIdbAtRestEncryption']);

/**
 * All experimental feature flags, grouped by catalog tier, with maturity/risk badges and
 * dependency-aware disabling. The flag list, labels, badges, ordering and dependencies are all
 * derived from FEATURE_CATALOG — no hand-maintained parallel array.
 */
export const FeatureFlagsSection: FC = () => {
  const { t, featureFlags, handleSettingChange } = useSettingsViewContext();
  const dispatch = useAppDispatch();
  const toast = useToast();
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // QNBS-v3: desktop-only flags (e.g. Rust Compute) no-op on web; surface that as a hint.
  const isDesktop = useMemo(() => isTauriRuntime(), []);

  // QNBS-v3: catalog grouped by tier, preserving FEATURE_TIER_ORDER, excluding hidden flags.
  const groups = useMemo(() => {
    const visible = FEATURE_CATALOG.filter((e) => !HIDDEN_FLAGS.has(e.flagKey));
    return FEATURE_TIER_ORDER.map((tier) => ({
      tier,
      entries: visible.filter((e) => e.tier === tier),
    })).filter((g) => g.entries.length > 0);
  }, []);

  const renderBadge = (entry: FeatureCatalogEntry): ReactNode => {
    const variant = MATURITY_TO_BADGE[entry.maturity];
    if (!variant) return undefined;
    const label = variant === 'beta' ? t('common.badge.beta') : t('common.badge.experimental');
    return <Badge variant={variant}>{label}</Badge>;
  };

  // QNBS-v3: compose a localized hint from dependency state + risk level (no English catalog text
  // is shown to users — only i18n strings).
  const buildHint = (entry: FeatureCatalogEntry): string | undefined => {
    const availability = resolveFlagAvailability(entry.flagKey, featureFlags, isDesktop);
    const parts: string[] = [];
    if (availability.blockedBy.length > 0) {
      const names = availability.blockedBy
        .map((dep) => t(`settings.featureFlags.${dep}`))
        .join(', ');
      parts.push(t('settings.featureFlags.dependency.requires', { name: names }));
    }
    if (availability.blockedByDesktop) {
      parts.push(t('settings.featureFlags.dependency.desktopOnly'));
    }
    if (entry.riskLevel === 'high') {
      parts.push(t('settings.featureFlags.risk.high'));
    }
    return parts.length > 0 ? parts.join(' · ') : undefined;
  };

  const handleReset = () => {
    dispatch(featureFlagsActions.setFeatureFlags(defaultFeatureFlagsState));
    toast.success(t('settings.featureFlags.resetDone'));
    setShowResetConfirm(false);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
              {t('settings.featureFlags.title')}
            </h2>
            <p className="text-sm text-[var(--sc-text-muted)] mt-1">
              {t('settings.featureFlags.description')}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowResetConfirm(true)}
            className="flex-shrink-0"
          >
            {t('settings.featureFlags.resetToDefaults')}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-6">
          {groups.map(({ tier, entries }) => (
            <section key={tier} aria-label={t(`settings.featureFlags.category.${tier}`)}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--sc-text-muted)] mb-3">
                {t(`settings.featureFlags.category.${tier}`)}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {entries.map((entry) => {
                  const { blockedBy } = resolveFlagAvailability(
                    entry.flagKey,
                    featureFlags,
                    isDesktop,
                  );
                  return (
                    <ToggleSwitch
                      key={entry.flagKey}
                      label={t(`settings.featureFlags.${entry.flagKey}`)}
                      badge={renderBadge(entry)}
                      hint={buildHint(entry)}
                      checked={featureFlags[entry.flagKey]}
                      disabled={blockedBy.length > 0}
                      onChange={(v) => handleSettingChange(entry.flagKey, v)}
                    />
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </CardContent>

      <Modal
        isOpen={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        title={t('settings.featureFlags.resetTitle')}
      >
        <p className="text-sm text-[var(--sc-text-secondary)]">
          {t('settings.featureFlags.resetConfirm')}
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setShowResetConfirm(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={handleReset}>
            {t('settings.featureFlags.resetToDefaults')}
          </Button>
        </div>
      </Modal>
    </Card>
  );
};
