// @vitest-environment node

import type { ProjectValidationResult } from '@domain/desktop-contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoryProject } from '../../../../types';

const h = vi.hoisted(() => ({
  isDesktop: true,
  validateProject: vi.fn<(_envelope: string) => Promise<ProjectValidationResult>>(),
  debug: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../../../services/desktopPlatform', () => ({
  get desktopPlatform() {
    return {
      runtime: { isDesktop: h.isDesktop, os: 'linux' },
      project: { validateProject: h.validateProject },
    };
  },
}));
vi.mock('../../../../services/logger', () => ({
  logger: { debug: h.debug, warn: h.warn },
}));

import {
  CORE_VALIDATION_MAX_ENVELOPE_BYTES,
  observeCoreProjectValidation,
} from '../../../../features/project/coreValidationShadow';

const project: StoryProject = {
  title: 'Shadow project',
  logline: 'A bounded observer test.',
  characters: [],
  worlds: [],
  manuscript: [],
};

const validResult: ProjectValidationResult = {
  contractVersion: '1.0.0',
  valid: true,
  schemaVersion: 2,
};

beforeEach(() => {
  h.isDesktop = true;
  h.validateProject.mockReset();
  h.debug.mockReset();
  h.warn.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function flushShadow(): Promise<void> {
  await vi.waitFor(() =>
    expect(h.debug.mock.calls.length + h.warn.mock.calls.length).toBeGreaterThan(0),
  );
}

describe('observeCoreProjectValidation', () => {
  it('does nothing for the web/PWA runtime', () => {
    h.isDesktop = false;
    observeCoreProjectValidation(project);

    expect(h.validateProject).not.toHaveBeenCalled();
    expect(h.debug).not.toHaveBeenCalled();
    expect(h.warn).not.toHaveBeenCalled();
  });

  it('observes a valid verdict without exposing project content', async () => {
    h.validateProject.mockResolvedValueOnce(validResult);
    observeCoreProjectValidation(project);
    await flushShadow();

    expect(h.validateProject).toHaveBeenCalledTimes(1);
    expect(h.debug).toHaveBeenCalledWith('project Core shadow validation', {
      verdict: 'valid',
      schemaVersion: 2,
      contractVersion: '1.0.0',
      errorClass: null,
      durationMs: expect.any(Number),
    });
    expect(JSON.stringify(h.debug.mock.calls)).not.toContain(project.title);
  });

  it('logs an invalid verdict without changing the load-side contract', async () => {
    h.validateProject.mockResolvedValueOnce({
      contractVersion: '1.0.0',
      valid: false,
      schemaVersion: 2,
      error: 'entity-secret-id must not be logged',
    });
    observeCoreProjectValidation(project);
    await flushShadow();

    expect(h.warn).toHaveBeenCalledWith('project Core shadow validation', {
      verdict: 'invalid',
      schemaVersion: 2,
      contractVersion: '1.0.0',
      errorClass: 'native-validation-failure',
      durationMs: expect.any(Number),
    });
    expect(JSON.stringify(h.warn.mock.calls)).not.toContain('entity-secret-id');
  });

  it('swallows asynchronous validator rejection with one normalized error entry', async () => {
    h.validateProject.mockRejectedValueOnce(
      new Error('worldscript_project_validate failed: Error raw-project-id-secret'),
    );
    const unhandledRejection = vi.fn();
    process.on('unhandledRejection', unhandledRejection);
    try {
      observeCoreProjectValidation(project);
      await flushShadow();
    } finally {
      process.off('unhandledRejection', unhandledRejection);
    }

    expect(h.warn).toHaveBeenCalledTimes(1);
    expect(unhandledRejection).not.toHaveBeenCalled();
    expect(h.warn).toHaveBeenCalledWith('project Core shadow validation', {
      verdict: 'error',
      schemaVersion: null,
      contractVersion: null,
      errorClass: 'native-validation-error',
      durationMs: expect.any(Number),
    });
    expect(JSON.stringify(h.warn.mock.calls)).not.toContain('raw-project-id-secret');
  });

  it('swallows synchronous envelope failures', async () => {
    const malformed = { ...project, characters: [{ ...project.characters, id: '' }] } as never;
    observeCoreProjectValidation(malformed);
    await flushShadow();

    expect(h.validateProject).not.toHaveBeenCalled();
    expect(h.warn).toHaveBeenCalledWith('project Core shadow validation', {
      verdict: 'error',
      schemaVersion: null,
      contractVersion: null,
      errorClass: 'core-boundary-validation',
      durationMs: expect.any(Number),
    });
  });

  it('skips envelopes above the size cap without IPC', () => {
    const largeProject: StoryProject = {
      ...project,
      manuscript: [
        { id: 'large', title: 'Large', content: 'x'.repeat(CORE_VALIDATION_MAX_ENVELOPE_BYTES) },
      ],
    };
    observeCoreProjectValidation(largeProject);

    expect(h.validateProject).not.toHaveBeenCalled();
    expect(h.debug).toHaveBeenCalledWith('project Core shadow validation', {
      verdict: 'skipped',
      schemaVersion: null,
      contractVersion: null,
      errorClass: null,
      durationMs: expect.any(Number),
      skipReason: 'size-cap',
    });
  });
});
