import type { FC } from 'react';
import { FEATURE_CATALOG, type FeatureMaturity } from '../../features/featureCatalog';
import type { FeatureFlagsState } from '../../features/featureFlags/featureFlagsSlice';
import { useTranslation } from '../../hooks/useTranslation';
import { Badge, type BadgeVariant } from '../ui/Badge';

// QNBS-v3: maturity → badge variant, single source for the whole Settings surface. Derived from
// FEATURE_CATALOG so a section's badge can never drift from the catalog/slice. The strict
// FeatureMaturity-keyed Record forces every maturity value to be handled (a new one fails to
// compile). `stable` → no badge (Production needs no pill); `beta` → Beta; everything else → Experimental.
const MATURITY_TO_BADGE: Record<FeatureMaturity, BadgeVariant | undefined> = {
  stable: undefined,
  beta: 'beta',
  experimental: 'experimental',
  stub: 'experimental',
  ghost: 'experimental',
};

/** Returns the badge variant a flag's feature should carry, or `undefined` for stable/unlisted. */
export function maturityBadgeVariant(flagKey: keyof FeatureFlagsState): BadgeVariant | undefined {
  const entry = FEATURE_CATALOG.find((e) => e.flagKey === flagKey);
  return entry ? MATURITY_TO_BADGE[entry.maturity] : undefined;
}

/**
 * Inline maturity pill for a Settings section/flag, driven by FEATURE_CATALOG. Renders nothing for
 * stable/unlisted features. Reused by both the dedicated section headers and the Experimental flags
 * list, so the maturity signalling is consistent everywhere.
 */
export const MaturityBadge: FC<{
  flagKey: keyof FeatureFlagsState;
  className?: string;
}> = ({ flagKey, className }) => {
  const { t } = useTranslation();
  const variant = maturityBadgeVariant(flagKey);
  if (!variant) return null;
  const label = variant === 'beta' ? t('common.badge.beta') : t('common.badge.experimental');
  // QNBS-v3: the badge is always announced — "Experimental/Beta" conveys feature readiness (real
  // status), not decoration, so it must reach screen-reader users. exactOptionalPropertyTypes:
  // only pass className when defined.
  return (
    <Badge variant={variant} {...(className !== undefined && { className })}>
      {label}
    </Badge>
  );
};

MaturityBadge.displayName = 'MaturityBadge';
