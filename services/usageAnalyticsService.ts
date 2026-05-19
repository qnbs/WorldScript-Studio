/**
 * Privacy-first usage analytics service.
 * QNBS-v3: Opt-in only (default: off). No PII — only event type + timestamp + device class.
 *          Ring buffer (500 events max) stored in memory; no external network calls.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AnalyticsEventType =
  | 'ai_provider_selected'
  | 'local_model_loaded'
  | 'feature_flag_toggled'
  | 'prompt_category_used'
  | 'eco_mode_toggled'
  | 'export_triggered'
  | 'collaboration_joined';

export interface AnalyticsEvent {
  type: AnalyticsEventType;
  timestamp: number;
  /** Device class from DeviceHealthService — never includes PII. */
  deviceClass?: string;
  /** Generic metadata bucket — all string values, no user content. */
  meta?: Record<string, string>;
}

export interface AnalyticsSummary {
  totalEvents: number;
  byType: Record<string, number>;
  oldestEvent: number | null;
  newestEvent: number | null;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const RING_BUFFER_MAX = 500;

class UsageAnalyticsService {
  private enabled = false;
  private events: AnalyticsEvent[] = [];

  /** Enable or disable analytics. Opt-in required — must be called with `true` explicitly. */
  setEnabled(value: boolean): void {
    this.enabled = value;
    if (!value) this.events = [];
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Record an analytics event.
   * QNBS-v3: No-ops silently when analytics are disabled — callers never need to guard.
   */
  track(type: AnalyticsEventType, meta?: Record<string, string>, deviceClass?: string): void {
    if (!this.enabled) return;

    const event: AnalyticsEvent = {
      type,
      timestamp: Date.now(),
      ...(deviceClass ? { deviceClass } : {}),
      ...(meta ? { meta } : {}),
    };

    this.events.push(event);

    // QNBS-v3: Ring buffer — evict oldest when limit reached to bound memory usage.
    if (this.events.length > RING_BUFFER_MAX) {
      this.events.splice(0, this.events.length - RING_BUFFER_MAX);
    }
  }

  /** Return aggregated counts — no raw event data exposed to prevent accidental PII leak. */
  getAnonymizedSummary(): AnalyticsSummary {
    const byType: Record<string, number> = {};
    let oldest: number | null = null;
    let newest: number | null = null;

    for (const e of this.events) {
      byType[e.type] = (byType[e.type] ?? 0) + 1;
      if (oldest === null || e.timestamp < oldest) oldest = e.timestamp;
      if (newest === null || e.timestamp > newest) newest = e.timestamp;
    }

    return {
      totalEvents: this.events.length,
      byType,
      oldestEvent: oldest,
      newestEvent: newest,
    };
  }

  /** Flush all stored events (e.g. on sign-out or settings reset). */
  flush(): void {
    this.events = [];
  }

  /** Raw event count — for tests and diagnostics only. */
  get _eventCount(): number {
    return this.events.length;
  }
}

export const usageAnalyticsService = new UsageAnalyticsService();
