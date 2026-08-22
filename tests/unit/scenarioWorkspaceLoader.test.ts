import { describe, expect, it, vi } from 'vitest';
import { loadScenarioWorkspaceView } from '../../services/scenarioWorkspaceLoader';

vi.mock('../../components/ScenarioWorkspaceView', () => ({
  ScenarioWorkspaceView: 'ScenarioWorkspaceView',
}));

describe('loadScenarioWorkspaceView', () => {
  it('resolves the canonical Scenario component for the lazy App route', async () => {
    // QNBS-v3: Protect the code-split route from silently resolving the wrong named export.
    await expect(loadScenarioWorkspaceView()).resolves.toEqual({
      default: 'ScenarioWorkspaceView',
    });
  });
});
