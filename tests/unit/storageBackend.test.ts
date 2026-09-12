import { describe, expect, it } from 'vitest';
import { charactersAdapter, worldsAdapter } from '../../features/project/adapters';
import type { ProjectData } from '../../features/project/projectSlice';
import {
  makeImageStorageKey,
  normalizeSaveProjectInputToStoryProject,
  saveEnvelopeFromProjectData,
} from '../../services/storageBackend';
import type { StoryProject } from '../../types';

const minimalProjectData = (): ProjectData => ({
  id: 'p1',
  title: 'T',
  logline: 'L',
  characters: charactersAdapter.getInitialState(),
  worlds: worldsAdapter.getInitialState(),
  outline: [],
  manuscript: [],
});

describe('storageBackend', () => {
  // QNBS-v3: whitespace/colon sanitization alone would collapse "alpha beta" and "alpha:beta" to the same "alpha_beta" prefix -- the full-projectId digest must keep them distinct.
  describe('makeImageStorageKey', () => {
    it('produces different keys for project ids that sanitize to the same prefix', async () => {
      const keyA = await makeImageStorageKey('alpha beta', 'char-1');
      const keyB = await makeImageStorageKey('alpha:beta', 'char-1');
      const keyC = await makeImageStorageKey('alpha_beta', 'char-1');
      expect(keyA).not.toBe(keyB);
      expect(keyA).not.toBe(keyC);
      expect(keyB).not.toBe(keyC);
    });

    it('produces different keys for project ids differing only after the 200-char truncation point', async () => {
      const longA = `${'x'.repeat(210)}-A`;
      const longB = `${'x'.repeat(210)}-B`;
      expect(await makeImageStorageKey(longA, 'char-1')).not.toBe(
        await makeImageStorageKey(longB, 'char-1'),
      );
    });

    it('is deterministic across repeated calls with the same inputs', async () => {
      const first = await makeImageStorageKey('proj-1', 'char-1');
      const second = await makeImageStorageKey('proj-1', 'char-1');
      expect(first).toBe(second);
    });

    it('keeps distinct entity ids distinct within the same project', async () => {
      const keyA = await makeImageStorageKey('proj-1', 'char-1');
      const keyB = await makeImageStorageKey('proj-1', 'char-2');
      expect(keyA).not.toBe(keyB);
    });
  });

  describe('saveEnvelopeFromProjectData', () => {
    it('returns a typed envelope for auto-save', () => {
      const data = minimalProjectData();
      const env = saveEnvelopeFromProjectData(data);
      expect(env).toEqual({ data });
      expect(env.present).toBeUndefined();
    });
  });

  describe('normalizeSaveProjectInputToStoryProject', () => {
    it('flattens { data } envelope', () => {
      const data = minimalProjectData();
      const flat = normalizeSaveProjectInputToStoryProject({ data });
      expect(flat).toBe(data);
    });

    it('flattens { present: { data } } envelope', () => {
      const data = minimalProjectData();
      const flat = normalizeSaveProjectInputToStoryProject({ present: { data } });
      expect(flat).toBe(data);
    });

    it('returns flat StoryProject unchanged', () => {
      const sp: StoryProject = {
        title: 'X',
        logline: 'Y',
        characters: [],
        worlds: [],
        manuscript: [],
      };
      expect(normalizeSaveProjectInputToStoryProject(sp)).toBe(sp);
    });
  });
});
