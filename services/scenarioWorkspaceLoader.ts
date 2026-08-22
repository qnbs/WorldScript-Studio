// QNBS-v3: Isolate the Scenario chunk loader so its routing contract has a lightweight regression test.
export const loadScenarioWorkspaceView = () =>
  import('../components/ScenarioWorkspaceView').then((module) => ({
    default: module.ScenarioWorkspaceView,
  }));
