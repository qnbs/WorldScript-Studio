import { describe, it, expect } from 'vitest';
import settingsReducer from '../../features/settings/settingsSlice';

// Read what settingsSlice exports
describe('settingsSlice', () => {
  it('should have initial state with expected shape', () => {
    const state = settingsReducer(undefined, { type: '@@INIT' });
    expect(state).toBeDefined();
    expect(state).toHaveProperty('theme');
    expect(state).toHaveProperty('aiCreativity');
  });
});
