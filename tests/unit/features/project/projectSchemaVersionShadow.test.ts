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
  it('logs LEGACY_UNVERSIONED at debug level', () => {
    observeProjectVersionClassificationFromObject({ title: 'Old Project' }, 'idb-load');

    expect(h.debug).toHaveBeenCalledWith(
      'project schema-version classification (observation-only)',
      {
        classification: 'LEGACY_UNVERSIONED',
        ingressPath: 'idb-load',
      },
    );
    expect(h.warn).not.toHaveBeenCalled();
  });

  it('logs MALFORMED at warn level', () => {
    observeProjectVersionClassificationFromObject({ schemaVersion: 'not-a-number' }, 'idb-load');

    expect(h.warn).toHaveBeenCalledWith(
      'project schema-version classification (observation-only)',
      {
        classification: 'MALFORMED',
        ingressPath: 'idb-load',
      },
    );
    expect(h.debug).not.toHaveBeenCalled();
  });

  it('logs FUTURE at warn level', () => {
    observeProjectVersionClassificationFromObject({ schemaVersion: 999 }, 'idb-load');

    expect(h.warn).toHaveBeenCalledWith(
      'project schema-version classification (observation-only)',
      {
        classification: 'FUTURE',
        ingressPath: 'idb-load',
      },
    );
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
  it('logs CURRENT at debug level', () => {
    observeProjectVersionClassificationFromText('{"schemaVersion": 1}', 'filesystem-load');

    expect(h.debug).toHaveBeenCalledWith(
      'project schema-version classification (observation-only)',
      {
        classification: 'CURRENT',
        ingressPath: 'filesystem-load',
      },
    );
  });

  it('logs MALFORMED at warn level for unparseable text', () => {
    observeProjectVersionClassificationFromText('{not valid json', 'filesystem-load');

    expect(h.warn).toHaveBeenCalledWith(
      'project schema-version classification (observation-only)',
      {
        classification: 'MALFORMED',
        ingressPath: 'filesystem-load',
      },
    );
  });
});
