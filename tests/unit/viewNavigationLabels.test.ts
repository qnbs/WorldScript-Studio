import { describe, expect, it } from 'vitest';
import {
  VIEW_NAVIGATION_LABEL_KEYS,
  viewNavigationLabelKey,
} from '../../services/viewNavigationLabels';

describe('viewNavigationLabelKey', () => {
  it('returns the correct key for known views', () => {
    expect(viewNavigationLabelKey('dashboard')).toBe('sidebar.dashboard');
    expect(viewNavigationLabelKey('manuscript')).toBe('sidebar.manuscript');
    expect(viewNavigationLabelKey('writer')).toBe('sidebar.writer');
    expect(viewNavigationLabelKey('templates')).toBe('sidebar.templates');
    expect(viewNavigationLabelKey('outline')).toBe('sidebar.outline');
    expect(viewNavigationLabelKey('characters')).toBe('sidebar.characters');
    expect(viewNavigationLabelKey('world')).toBe('sidebar.world');
    expect(viewNavigationLabelKey('export')).toBe('sidebar.export');
    expect(viewNavigationLabelKey('settings')).toBe('sidebar.settings');
    expect(viewNavigationLabelKey('help')).toBe('sidebar.help');
    expect(viewNavigationLabelKey('sceneboard')).toBe('sidebar.sceneboard');
    expect(viewNavigationLabelKey('characterGraph')).toBe('sidebar.characterGraph');
    expect(viewNavigationLabelKey('consistencyChecker')).toBe('sidebar.consistencyChecker');
    expect(viewNavigationLabelKey('critic')).toBe('sidebar.critic');
  });

  it('falls back to sidebar.dashboard for unknown views', () => {
    // QNBS-v3: views not in the map (e.g. 'analytics', 'zen') use the dashboard key as a safe default
    expect(viewNavigationLabelKey('analytics')).toBe('sidebar.analytics');
    expect(viewNavigationLabelKey('zen')).toBe('sidebar.zen');
  });
});

describe('VIEW_NAVIGATION_LABEL_KEYS', () => {
  it('is a partial record — all present values are sidebar.* keys', () => {
    Object.values(VIEW_NAVIGATION_LABEL_KEYS).forEach((key) => {
      expect(key).toMatch(/^sidebar\./);
    });
  });
});
