import { CANONICAL_ALIASES, CANONICAL_URL, REQUIRED_RUNS, SCOPE } from './scope.mjs';
import { FULL_SHA, parseJson, refuse } from './util.mjs';

export function readMain(deps) {
  const sha = deps.git(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0].trim();
  return FULL_SHA.test(sha) ? sha : refuse('main-unreadable');
}

export function readOpenPrs(deps) {
  const fields = 'number,headRefName,headRefOid';
  const args = ['pr', 'list', '--repo', SCOPE.repository, '--state', 'open', '--limit', '100'];
  const prs = parseJson(deps.gh([...args, '--json', fields]), 'open-prs');
  if (!Array.isArray(prs) || prs.length >= 100) refuse('open-prs-incomplete');
  return prs;
}

export function readBranches(deps) {
  const lines = deps.git(['ls-remote', '--heads', 'origin']).split('\n').filter(Boolean);
  return new Set(lines.map((line) => line.split('\trefs/heads/')[1]).filter(Boolean));
}

function readRuns(deps, sha) {
  const args = ['run', 'list', '--repo', SCOPE.repository, '--commit', sha, '--limit', '50'];
  const runs = parseJson(deps.gh([...args, '--json', 'name,status,conclusion']), 'runs');
  return Array.isArray(runs) ? runs : refuse('runs-unreadable');
}

const isGreen = (run) => run.status === 'completed' && run.conclusion === 'success';

// QNBS-v3: every run of a required workflow on this exact SHA must be a completed success, so a rerun in flight or an older failed attempt stops the pass instead of being outvoted.
export function assertRequiredRuns(deps, sha) {
  const runs = readRuns(deps, sha);
  for (const name of REQUIRED_RUNS) {
    const named = runs.filter((run) => run.name === name);
    if (named.length === 0 || !named.every(isGreen)) refuse(`gate-not-green:${name}`);
  }
}

const isProductionOn = (sha) => (deployment) =>
  [
    deployment.target === 'production',
    deployment.readyState === 'READY',
    deployment.meta?.githubCommitSha === sha,
  ].every(Boolean);

export function assertProduction(deps, world, sha) {
  const production = world.deployments.find(isProductionOn(sha));
  if (!production) refuse('production-not-ready-on-main');
  const bound = CANONICAL_ALIASES.filter((host) =>
    world.aliases.some((alias) => alias.alias === host && alias.deploymentId === production.uid),
  );
  if (bound.length !== CANONICAL_ALIASES.length) refuse('canonical-aliases-not-bound');
  if (deps.http(CANONICAL_URL) !== '200') refuse('canonical-http-failed');
  return production.uid;
}
