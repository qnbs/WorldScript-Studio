/**
 * Tests for components/settings/MaturityBadge.tsx
 * QNBS-v3: the badge variant is DERIVED from FEATURE_CATALOG maturity (single source of truth), so a
 * section badge can never drift from the catalog/slice. We assert the experimental + beta paths and
 * the catalog-derived helper.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

import { MaturityBadge, maturityBadgeVariant } from '../../../components/settings/MaturityBadge';

describe('maturityBadgeVariant', () => {
  it('maps an experimental feature to the experimental variant', () => {
    expect(maturityBadgeVariant('enableProForge')).toBe('experimental');
  });

  it('maps a stub feature to the experimental variant', () => {
    expect(maturityBadgeVariant('enableRtlLayout')).toBe('experimental');
  });

  it('maps a beta feature to the beta variant', () => {
    expect(maturityBadgeVariant('enablePluginSystem')).toBe('beta');
  });
});

describe('MaturityBadge', () => {
  it('renders the Experimental label for an experimental flag', () => {
    render(<MaturityBadge flagKey="enableVoiceSupport" />);
    expect(screen.getByText('common.badge.experimental')).toBeInTheDocument();
  });

  it('renders the Beta label for a beta flag', () => {
    render(<MaturityBadge flagKey="enablePluginSystem" />);
    expect(screen.getByText('common.badge.beta')).toBeInTheDocument();
  });

  it('renders the LoRA (experimental) badge', () => {
    render(<MaturityBadge flagKey="enableLoraAdapters" />);
    expect(screen.getByText('common.badge.experimental')).toBeInTheDocument();
  });
});
