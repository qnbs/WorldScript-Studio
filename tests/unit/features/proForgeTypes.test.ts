/**
 * Tests for features/proForge/types.ts
 * QNBS-v3: Pure constants and helper functions — PIPELINE_STAGES, isEditingStage, nextStage, prevStage.
 */

import { describe, expect, it } from 'vitest';
import {
  EDITING_STAGES,
  isEditingStage,
  nextStage,
  PIPELINE_STAGES,
  prevStage,
} from '../../../features/proForge/types';

describe('PIPELINE_STAGES', () => {
  it('contains all 10 stages', () => {
    expect(PIPELINE_STAGES).toHaveLength(10);
  });

  it('starts with idle', () => {
    expect(PIPELINE_STAGES[0]).toBe('idle');
  });

  it('ends with archived', () => {
    expect(PIPELINE_STAGES[PIPELINE_STAGES.length - 1]).toBe('archived');
  });

  it('includes all key stages', () => {
    const required = [
      'intake',
      'structural',
      'lineProse',
      'copyEdit',
      'proof',
      'production',
      'publishing',
      'analytics',
    ];
    for (const s of required) {
      expect(PIPELINE_STAGES).toContain(s);
    }
  });
});

describe('EDITING_STAGES', () => {
  it('has 5 editing stages', () => {
    expect(EDITING_STAGES).toHaveLength(5);
  });

  it('includes copyEdit', () => {
    expect(EDITING_STAGES).toContain('copyEdit');
  });

  it('does not include production or publishing', () => {
    expect(EDITING_STAGES).not.toContain('production');
    expect(EDITING_STAGES).not.toContain('publishing');
  });
});

describe('isEditingStage', () => {
  it('returns true for intake', () => {
    expect(isEditingStage('intake')).toBe(true);
  });

  it('returns true for structural', () => {
    expect(isEditingStage('structural')).toBe(true);
  });

  it('returns true for lineProse', () => {
    expect(isEditingStage('lineProse')).toBe(true);
  });

  it('returns true for copyEdit', () => {
    expect(isEditingStage('copyEdit')).toBe(true);
  });

  it('returns true for proof', () => {
    expect(isEditingStage('proof')).toBe(true);
  });

  it('returns false for production', () => {
    expect(isEditingStage('production')).toBe(false);
  });

  it('returns false for idle', () => {
    expect(isEditingStage('idle')).toBe(false);
  });

  it('returns false for archived', () => {
    expect(isEditingStage('archived')).toBe(false);
  });
});

describe('nextStage', () => {
  it('returns structural after intake', () => {
    expect(nextStage('intake')).toBe('structural');
  });

  it('returns null for archived (last stage)', () => {
    expect(nextStage('archived')).toBeNull();
  });

  it('returns intake after idle', () => {
    expect(nextStage('idle')).toBe('intake');
  });

  it('returns analytics after publishing', () => {
    expect(nextStage('publishing')).toBe('analytics');
  });
});

describe('prevStage', () => {
  it('returns null for idle (first stage)', () => {
    expect(prevStage('idle')).toBeNull();
  });

  it('returns idle before intake', () => {
    expect(prevStage('intake')).toBe('idle');
  });

  it('returns structural before lineProse', () => {
    expect(prevStage('lineProse')).toBe('structural');
  });

  it('returns publishing before analytics', () => {
    expect(prevStage('analytics')).toBe('publishing');
  });
});
