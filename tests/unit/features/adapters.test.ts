/**
 * Tests for features/project/adapters.ts
 * QNBS-v3: Entity adapters — verify they are properly initialized with CRUD selectors.
 */

import { describe, expect, it } from 'vitest';
import { charactersAdapter, worldsAdapter } from '../../../features/project/adapters';

describe('charactersAdapter', () => {
  it('has getInitialState function', () => {
    expect(typeof charactersAdapter.getInitialState).toBe('function');
  });

  it('creates initial state with ids and entities', () => {
    const state = charactersAdapter.getInitialState();
    expect(state.ids).toEqual([]);
    expect(state.entities).toEqual({});
  });

  it('addOne adds a character', () => {
    const state = charactersAdapter.getInitialState();
    const char = { id: 'c1', name: 'Alice', archetype: 'hero' };
    const next = charactersAdapter.addOne(state, char as never);
    expect(next.ids).toContain('c1');
  });

  it('removeOne removes a character', () => {
    const state = charactersAdapter.getInitialState();
    const char = { id: 'c1', name: 'Alice' };
    const withChar = charactersAdapter.addOne(state, char as never);
    const next = charactersAdapter.removeOne(withChar, 'c1');
    expect(next.ids).not.toContain('c1');
  });

  it('getSelectors returns selectors including selectAll', () => {
    const selectors = charactersAdapter.getSelectors();
    expect(typeof selectors.selectAll).toBe('function');
    expect(typeof selectors.selectById).toBe('function');
    expect(typeof selectors.selectIds).toBe('function');
  });
});

describe('worldsAdapter', () => {
  it('has getInitialState function', () => {
    expect(typeof worldsAdapter.getInitialState).toBe('function');
  });

  it('creates initial state with ids and entities', () => {
    const state = worldsAdapter.getInitialState();
    expect(state.ids).toEqual([]);
    expect(state.entities).toEqual({});
  });

  it('addOne adds a world', () => {
    const state = worldsAdapter.getInitialState();
    const world = { id: 'w1', name: 'Middle-Earth', type: 'fantasy' };
    const next = worldsAdapter.addOne(state, world as never);
    expect(next.ids).toContain('w1');
  });
});
