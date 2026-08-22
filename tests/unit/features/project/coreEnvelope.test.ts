// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { CoreBoundaryValidationError } from '../../../../features/project/coreBoundaryAdapter';
import {
  buildCoreProjectEnvelope,
  CORE_PROJECT_SCHEMA_VERSION,
} from '../../../../features/project/coreEnvelope';
import envelopeFixture from '../../../../tests/fixtures/project-golden-masters/core-validation-envelope.json';
import type { Character, StoryProject, World } from '../../../../types';

const fixtureProject = envelopeFixture.project as StoryProject;
const fixtureCharacters = fixtureProject.characters as Character[];
const fixtureWorlds = fixtureProject.worlds as World[];
const firstCharacter = fixtureCharacters[0];
const firstWorld = fixtureWorlds[0];
if (!firstCharacter || !firstWorld) {
  throw new Error('core-validation-envelope.json must contain its representative entities');
}

describe('buildCoreProjectEnvelope', () => {
  // QNBS-v3: golden and rejection cases protect the synthetic envelope's Core compatibility boundary.
  it('serializes the empty project envelope at the current synthetic schema version', () => {
    const project: StoryProject = {
      title: 'Empty',
      logline: 'Nothing happens yet.',
      characters: [],
      worlds: [],
      manuscript: [],
    };

    expect(JSON.parse(buildCoreProjectEnvelope(project))).toEqual({
      schemaVersion: CORE_PROJECT_SCHEMA_VERSION,
      project,
    });
  });

  it('serializes the golden project fixture with array collections', () => {
    expect(buildCoreProjectEnvelope(fixtureProject)).toBe(JSON.stringify(envelopeFixture));
  });

  it('serializes EntityState collections through the same adapter boundary', () => {
    const project: StoryProject = {
      ...fixtureProject,
      characters: {
        ids: ['char-elin'],
        entities: { 'char-elin': firstCharacter },
      },
      worlds: {
        ids: ['world-greenhouse'],
        entities: { 'world-greenhouse': firstWorld },
      },
    };

    const parsed = JSON.parse(buildCoreProjectEnvelope(project));
    expect(parsed.project.characters).toEqual([firstCharacter]);
    expect(parsed.project.worlds).toEqual([firstWorld]);
  });

  it('propagates duplicate-ID boundary failures', () => {
    const project: StoryProject = {
      ...fixtureProject,
      characters: [firstCharacter, { ...firstCharacter }],
    };

    expect(() => buildCoreProjectEnvelope(project)).toThrow(CoreBoundaryValidationError);
  });
});
