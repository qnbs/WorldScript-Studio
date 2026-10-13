import { identityConfirmed } from './classify.mjs';
import { CANONICAL_ALIASES, CANONICAL_URL, REQUIRED_RUNS, SCOPE } from './scope.mjs';
import { FULL_SHA, parseJson, refuse } from './util.mjs';

const ORIGIN = new RegExp(
  `^(https://github\\.com/|git@github\\.com:|ssh://git@github\\.com/)${SCOPE.repository}(\\.git)?/?$`,
);

// QNBS-v3: branches and main are read through `origin`, while the provider and PR reads are pinned to the project's repository, so a checkout whose origin is a fork must stop before any inventory is built from the wrong branch set.
export function assertOrigin(deps) {
  const url = deps.git(['remote', 'get-url', 'origin']).trim();
  if (!ORIGIN.test(url)) refuse('origin-unexpected');
}

export function readMain(deps) {
  const sha = deps.git(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0].trim();
  return FULL_SHA.test(sha) ? sha : refuse('main-unreadable');
}

// QNBS-v3: an open-PR record that lacks a usable number, head branch or head commit would silently drop that PR's protection, so one malformed record refuses the whole snapshot.
const isOpenPr = (pr) =>
  [
    Number.isInteger(pr?.number) && pr.number > 0,
    typeof pr?.headRefName === 'string' && pr.headRefName !== '',
    FULL_SHA.test(pr?.headRefOid ?? ''),
  ].every(Boolean);

export function readOpenPrs(deps) {
  const fields = 'number,headRefName,headRefOid';
  const args = ['pr', 'list', '--repo', SCOPE.repository, '--state', 'open', '--limit', '100'];
  const prs = parseJson(deps.gh([...args, '--json', fields]), 'open-prs');
  if (!Array.isArray(prs)) refuse('open-prs-incomplete');
  if (prs.length >= 100) refuse('open-prs-incomplete');
  if (!prs.every(isOpenPr)) refuse('open-prs-malformed');
  return prs;
}

export function readBranches(deps) {
  const lines = deps.git(['ls-remote', '--heads', 'origin']).split('\n').filter(Boolean);
  return new Set(lines.map((line) => line.split('\trefs/heads/')[1]).filter(Boolean));
}

const RUN_LIMIT = 200;

// QNBS-v3: a list as long as the request limit may have been cut off, so it is treated as unreadable rather than as complete.
function readRuns(deps, sha) {
  const args = ['run', 'list', '--repo', SCOPE.repository, '--commit', sha];
  const fields = 'name,status,conclusion,event,headBranch,headSha';
  const runs = parseJson(
    deps.gh([...args, '--limit', String(RUN_LIMIT), '--json', fields]),
    'runs',
  );
  if (!Array.isArray(runs)) refuse('runs-unreadable');
  if (runs.length >= RUN_LIMIT) refuse('runs-incomplete');
  return runs;
}

const isGreen = (run) => run.status === 'completed' && run.conclusion === 'success';

const isMainPush = (sha) => (run) =>
  [run.event === 'push', run.headBranch === 'main', run.headSha === sha].every(Boolean);

// QNBS-v3: the post-merge gate is the push-triggered run on main for this exact SHA; a manual run or a tag run never stands in for it, and every such run must be a completed success so a rerun in flight or an older failure is not outvoted.
export function assertRequiredRuns(deps, sha) {
  const pushRuns = readRuns(deps, sha).filter(isMainPush(sha));
  for (const name of REQUIRED_RUNS) {
    const named = pushRuns.filter((run) => run.name === name);
    if (named.length === 0 || !named.every(isGreen)) refuse(`gate-not-green:${name}`);
  }
}

export const isProductionOn = (sha) => (deployment) =>
  [
    deployment.target === 'production',
    deployment.readyState === 'READY',
    deployment.meta?.githubCommitSha === sha,
    identityConfirmed(deployment),
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
