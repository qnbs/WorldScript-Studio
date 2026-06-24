/**
 * Tests for MaturityBadge's defensive "no catalog entry" path.
 * QNBS-v3: parity guarantees every flag is catalogued today, so the no-variant branch is unreachable
 * with real data — this file mocks an empty FEATURE_CATALOG to exercise (and document) the guard so
 * a future stable/uncatalogued flag degrades to "no badge" instead of crashing.
 */

import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../features/featureCatalog', () => ({ FEATURE_CATALOG: [] }));
vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

import { MaturityBadge, maturityBadgeVariant } from '../../../components/settings/MaturityBadge';

describe('MaturityBadge — no catalog entry', () => {
  it('maturityBadgeVariant returns undefined when the flag is not catalogued', () => {
    expect(maturityBadgeVariant('enableProForge')).toBeUndefined();
  });

  it('renders nothing when there is no matching catalog entry', () => {
    const { container } = render(<MaturityBadge flagKey="enableProForge" />);
    expect(container.firstChild).toBeNull();
  });
});
