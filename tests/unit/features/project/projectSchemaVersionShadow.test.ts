// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  debug: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../../../services/logger', () => ({
  logger: { debug: h.debug, warn: h.warn },
}));

import {
  observeProjectVersionClassificationFromObject,
  observeProjectVersionClassificationFromText,
} from '../../../../features/project/projectSchemaVersionShadow';

beforeEach(() => {
  h.debug.mockReset();
  h.warn.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('observeProjectVersionClassificationFromObject', () => {
  it.each([
    ['LEGACY_UNVERSIONED', { title: 'Old Project' }, 'debug'],
    ['MALFORMED', { schemaVersion: 'not-a-number' }, 'warn'],
    ['FUTURE', { schemaVersion: 999 }, 'warn'],
  ] as const)('logs %s at %s level', (classification, input, level) => {
    observeProjectVersionClassificationFromObject(input, 'idb-load');

    expect(h[level]).toHaveBeenCalledWith(
      'project schema-version classification (observation-only)',
      { classification, ingressPath: 'idb-load' },
    );
    const otherLevel = level === 'debug' ? 'warn' : 'debug';
    expect(h[otherLevel]).not.toHaveBeenCalled();
  });

  it('never throws, logging the observation failure instead', () => {
    // QNBS-v3: proves a classifier exception can never propagate into the caller's load path.
    const poisoned = {
      get schemaVersion(): never {
        throw new Error('boom');
      },
    };
    expect(() => observeProjectVersionClassificationFromObject(poisoned, 'idb-load')).not.toThrow();
    expect(h.warn).toHaveBeenCalledWith(
      'project schema-version classification observation failed',
      {
        ingressPath: 'idb-load',
        error: 'boom',
      },
    );
  });
});

describe('observeProjectVersionClassificationFromText', () => {
  it.each([
    ['CURRENT', '{"schemaVersion": 1}', 'debug'],
    ['MALFORMED', '{not valid json', 'warn'],
  ] as const)('logs %s at %s level', (classification, rawText, level) => {
    observeProjectVersionClassificationFromText(rawText, 'filesystem-load');

    expect(h[level]).toHaveBeenCalledWith(
      'project schema-version classification (observation-only)',
      { classification, ingressPath: 'filesystem-load' },
    );
  });
});
