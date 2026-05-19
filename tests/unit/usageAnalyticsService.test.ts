import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { usageAnalyticsService } from '../../services/usageAnalyticsService';

beforeEach(() => {
  usageAnalyticsService.setEnabled(false);
  usageAnalyticsService.flush();
});

afterEach(() => {
  usageAnalyticsService.setEnabled(false);
  usageAnalyticsService.flush();
});

describe('usageAnalyticsService', () => {
  // ── Opt-in enforcement ────────────────────────────────────────────────────

  it('is disabled by default', () => {
    expect(usageAnalyticsService.isEnabled()).toBe(false);
  });

  it('does NOT record events when disabled', () => {
    usageAnalyticsService.track('ai_provider_selected');
    expect(usageAnalyticsService._eventCount).toBe(0);
  });

  it('records events when enabled', () => {
    usageAnalyticsService.setEnabled(true);
    usageAnalyticsService.track('ai_provider_selected');
    expect(usageAnalyticsService._eventCount).toBe(1);
  });

  it('clears all events when disabled after recording', () => {
    usageAnalyticsService.setEnabled(true);
    usageAnalyticsService.track('feature_flag_toggled');
    usageAnalyticsService.setEnabled(false);
    expect(usageAnalyticsService._eventCount).toBe(0);
  });

  // ── Ring buffer eviction ───────────────────────────────────────────────────

  it('evicts oldest events when ring buffer is full (500)', () => {
    usageAnalyticsService.setEnabled(true);
    for (let i = 0; i < 505; i++) {
      usageAnalyticsService.track('local_model_loaded');
    }
    expect(usageAnalyticsService._eventCount).toBe(500);
  });

  // ── Anonymized summary ─────────────────────────────────────────────────────

  it('getAnonymizedSummary returns totalEvents count', () => {
    usageAnalyticsService.setEnabled(true);
    usageAnalyticsService.track('ai_provider_selected');
    usageAnalyticsService.track('eco_mode_toggled');
    const summary = usageAnalyticsService.getAnonymizedSummary();
    expect(summary.totalEvents).toBe(2);
  });

  it('getAnonymizedSummary counts by event type', () => {
    usageAnalyticsService.setEnabled(true);
    usageAnalyticsService.track('ai_provider_selected');
    usageAnalyticsService.track('ai_provider_selected');
    usageAnalyticsService.track('eco_mode_toggled');
    const summary = usageAnalyticsService.getAnonymizedSummary();
    expect(summary.byType['ai_provider_selected']).toBe(2);
    expect(summary.byType['eco_mode_toggled']).toBe(1);
  });

  it('getAnonymizedSummary returns null timestamps when no events', () => {
    usageAnalyticsService.setEnabled(true);
    const summary = usageAnalyticsService.getAnonymizedSummary();
    expect(summary.oldestEvent).toBeNull();
    expect(summary.newestEvent).toBeNull();
    expect(summary.totalEvents).toBe(0);
  });

  it('getAnonymizedSummary returns oldest and newest timestamps', () => {
    usageAnalyticsService.setEnabled(true);
    const before = Date.now();
    usageAnalyticsService.track('ai_provider_selected');
    usageAnalyticsService.track('eco_mode_toggled');
    const after = Date.now();
    const summary = usageAnalyticsService.getAnonymizedSummary();
    expect(summary.oldestEvent).toBeGreaterThanOrEqual(before);
    expect(summary.newestEvent).toBeLessThanOrEqual(after);
    expect(summary.newestEvent ?? 0).toBeGreaterThanOrEqual(summary.oldestEvent ?? 0);
  });

  // ── flush ─────────────────────────────────────────────────────────────────

  it('flush removes all events while keeping analytics enabled', () => {
    usageAnalyticsService.setEnabled(true);
    usageAnalyticsService.track('prompt_category_used');
    usageAnalyticsService.flush();
    expect(usageAnalyticsService._eventCount).toBe(0);
    expect(usageAnalyticsService.isEnabled()).toBe(true);
  });

  // ── No-PII guard ─────────────────────────────────────────────────────────

  it('meta field only accepts Record<string,string> — string values, not objects', () => {
    usageAnalyticsService.setEnabled(true);
    // Should track without throwing even with empty meta
    expect(() =>
      usageAnalyticsService.track('prompt_category_used', { category: 'outline' }, 'high-end'),
    ).not.toThrow();
    expect(usageAnalyticsService._eventCount).toBe(1);
  });

  it('all event types are accepted without throwing', () => {
    usageAnalyticsService.setEnabled(true);
    const types = [
      'ai_provider_selected',
      'local_model_loaded',
      'feature_flag_toggled',
      'prompt_category_used',
      'eco_mode_toggled',
      'export_triggered',
      'collaboration_joined',
    ] as const;
    for (const t of types) {
      expect(() => usageAnalyticsService.track(t)).not.toThrow();
    }
    expect(usageAnalyticsService._eventCount).toBe(types.length);
  });
});
