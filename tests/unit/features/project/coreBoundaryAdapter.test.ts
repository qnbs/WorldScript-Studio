// @vitest-environment node

import type { EntityState } from '@reduxjs/toolkit';
import { describe, expect, it } from 'vitest';
import {
  coreArrayToEntityState,
  entityStateToCoreArray,
  fromCoreProjectCollections,
  toCoreProjectCollections,
} from '../../../../features/project/coreBoundaryAdapter';
import type { Character, World } from '../../../../types';

const character = (id: string): Character => ({
  id,
  name: `Character ${id}`,
  backstory: '',
  motivation: '',
  appearance: '',
  personalityTraits: '',
  flaws: '',
  notes: '',
  characterArc: '',
  relationships: '',
});

const world = (id: string): World => ({
  id,
  name: `World ${id}`,
  description: '',
  geography: '',
  magicSystem: '',
  culture: '',
  notes: '',
  timeline: [],
  locations: [],
});

const malformedEntityState = <T extends { id: string }>(state: unknown) =>
  state as EntityState<T, string>;

describe('project Core boundary adapter', () => {
  it('preserves array order and IDs for both collections in both directions', () => {
    const source = {
      characters: coreArrayToEntityState([character('char-2'), character('char-1')], 'characters'),
      worlds: coreArrayToEntityState([world('world-2'), world('world-1')], 'worlds'),
    };

    const core = toCoreProjectCollections(source);
    expect(core.characters.map(({ id }) => id)).toEqual(['char-2', 'char-1']);
    expect(core.worlds.map(({ id }) => id)).toEqual(['world-2', 'world-1']);

    const restored = fromCoreProjectCollections(core);
    expect(restored.characters.ids).toEqual(source.characters.ids);
    expect(restored.worlds.ids).toEqual(source.worlds.ids);
    expect(restored.characters.entities).toEqual(source.characters.entities);
    expect(restored.worlds.entities).toEqual(source.worlds.entities);
  });

  it.each([
    [
      'characters',
      () => coreArrayToEntityState([character('duplicate'), character('duplicate')], 'characters'),
    ],
    ['worlds', () => coreArrayToEntityState([world('duplicate'), world('duplicate')], 'worlds')],
  ])('rejects duplicate %s IDs in Core arrays', (_collection, convert) => {
    expect(convert).toThrow(/duplicate id/);
  });

  it.each([
    [
      'characters',
      () =>
        entityStateToCoreArray(
          malformedEntityState({
            ids: ['duplicate', 'duplicate'],
            entities: { duplicate: character('duplicate') },
          }),
          'characters',
        ),
    ],
    [
      'worlds',
      () =>
        entityStateToCoreArray(
          malformedEntityState({
            ids: ['duplicate', 'duplicate'],
            entities: { duplicate: world('duplicate') },
          }),
          'worlds',
        ),
    ],
  ])('rejects duplicate %s IDs in EntityState ids', (_collection, convert) => {
    expect(convert).toThrow(/duplicate id/);
  });

  it.each([
    ['characters', () => coreArrayToEntityState([character('')], 'characters')],
    ['worlds', () => coreArrayToEntityState([world('')], 'worlds')],
  ])('rejects missing %s stable IDs in Core arrays', (_collection, convert) => {
    expect(convert).toThrow(/missing a stable id/);
  });

  it.each([
    [
      'characters',
      () =>
        entityStateToCoreArray(
          malformedEntityState({ ids: ['missing'], entities: {} }),
          'characters',
        ),
    ],
    [
      'worlds',
      () =>
        entityStateToCoreArray(malformedEntityState({ ids: ['missing'], entities: {} }), 'worlds'),
    ],
  ])('rejects %s ids that reference missing entities', (_collection, convert) => {
    expect(convert).toThrow(/references missing entity/);
  });

  it.each([
    [
      'characters',
      () => entityStateToCoreArray(malformedEntityState({ ids: [''], entities: {} }), 'characters'),
    ],
    [
      'worlds',
      () => entityStateToCoreArray(malformedEntityState({ ids: [''], entities: {} }), 'worlds'),
    ],
  ])('rejects missing %s stable IDs in EntityState ids', (_collection, convert) => {
    expect(convert).toThrow(/missing a stable id/);
  });

  it.each([
    [
      'characters',
      () =>
        entityStateToCoreArray(
          malformedEntityState({ ids: ['empty'], entities: { empty: undefined } }),
          'characters',
        ),
    ],
    [
      'worlds',
      () =>
        entityStateToCoreArray(
          malformedEntityState({ ids: ['empty'], entities: { empty: undefined } }),
          'worlds',
        ),
    ],
  ])('rejects %s EntityState entries with no value', (_collection, convert) => {
    expect(convert).toThrow(/has no value/);
  });

  it.each([
    [
      'characters',
      () =>
        entityStateToCoreArray(
          malformedEntityState({ ids: ['listed'], entities: { listed: character('') } }),
          'characters',
        ),
    ],
    [
      'worlds',
      () =>
        entityStateToCoreArray(
          malformedEntityState({ ids: ['listed'], entities: { listed: world('') } }),
          'worlds',
        ),
    ],
  ])('rejects %s entities with missing stable IDs', (_collection, convert) => {
    expect(convert).toThrow(/missing a stable id/);
  });

  it.each([
    [
      'characters',
      () =>
        entityStateToCoreArray(
          malformedEntityState({ ids: ['listed'], entities: { listed: character('other') } }),
          'characters',
        ),
    ],
    [
      'worlds',
      () =>
        entityStateToCoreArray(
          malformedEntityState({ ids: ['listed'], entities: { listed: world('other') } }),
          'worlds',
        ),
    ],
  ])('rejects %s entity key and ID mismatches', (_collection, convert) => {
    expect(convert).toThrow(/does not match entity id/);
  });

  it.each([
    [
      'characters',
      () => coreArrayToEntityState([undefined] as unknown as Character[], 'characters'),
    ],
    ['worlds', () => coreArrayToEntityState([undefined] as unknown as World[], 'worlds')],
  ])('rejects %s array entries without stable IDs', (_collection, convert) => {
    expect(convert).toThrow(/missing a stable id/);
  });

  it.each([
    [
      'characters',
      () =>
        entityStateToCoreArray(
          malformedEntityState({
            ids: ['listed'],
            entities: { listed: character('listed'), orphan: character('orphan') },
          }),
          'characters',
        ),
    ],
    [
      'worlds',
      () =>
        entityStateToCoreArray(
          malformedEntityState({
            ids: ['listed'],
            entities: { listed: world('listed'), orphan: world('orphan') },
          }),
          'worlds',
        ),
    ],
  ])('rejects orphan %s entities absent from ids', (_collection, convert) => {
    expect(convert).toThrow(/orphan entity/);
  });
});
