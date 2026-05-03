import { describe, expect, it } from 'vitest';
import type { ProjectData } from '../../features/project/projectSlice';
import {
  normalizeSaveProjectInputToStoryProject,
  saveEnvelopeFromProjectData,
} from '../../services/storageBackend';
import { charactersAdapter, worldsAdapter } from '../../features/project/adapters';
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
