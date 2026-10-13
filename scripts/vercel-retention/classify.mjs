import { CANONICAL_ALIASES, SCOPE, TERMINAL_STATES } from './scope.mjs';
import { anyOf, FULL_SHA } from './util.mjs';

// QNBS-v3: anything that is, is moving to, was promoted as, or can roll back to Production is Production-class and never enters the preview classification at all.
export const isProductionClass = (deployment) =>
  anyOf(
    deployment.target === 'production',
    deployment.readySubstate === 'PROMOTED',
    deployment.readySubstate === 'ROLLING',
    deployment.isRollbackCandidate === true,
  );

function aliasesByDeployment(aliases) {
  const map = new Map();
  for (const entry of aliases)
    map.set(entry.deploymentId, [...(map.get(entry.deploymentId) ?? []), entry.alias]);
  return map;
}

// QNBS-v3: the exact per-PR snapshot keeps the newest min(3, available) Previews of every open PR; a preview without a usable creation time is ranked out, because it is UNKNOWN and never deleted, so it cannot displace a dated one.
function newestThreeOfOpenPrs(prs, previews) {
  const kept = new Set();
  for (const pr of prs) {
    const own = previews
      .filter((deployment) => deployment.meta?.githubPrId === String(pr.number))
      .filter((deployment) => Number.isFinite(deployment.created))
      .sort((a, b) => b.created - a.created)
      .slice(0, 3);
    for (const deployment of own) kept.add(deployment.uid);
  }
  return kept;
}

function identityConfirmed(deployment) {
  const meta = deployment.meta ?? {};
  return [
    deployment.projectId === SCOPE.projectId,
    meta.githubOrg === SCOPE.org,
    meta.githubRepo === SCOPE.repo,
  ].every(Boolean);
}

function unknownReasons(deployment) {
  const reasons = [];
  if (!identityConfirmed(deployment)) reasons.push('identity-unconfirmed');
  if (!TERMINAL_STATES.has(deployment.readyState)) reasons.push('non-terminal-state');
  if (typeof deployment.isRollbackCandidate !== 'boolean') reasons.push('rollback-unknown');
  if (!deployment.meta?.githubCommitRef) reasons.push('branch-unknown');
  if (!FULL_SHA.test(deployment.meta?.githubCommitSha ?? '')) reasons.push('commit-unknown');
  if (!Number.isFinite(deployment.created)) reasons.push('created-unknown');
  return reasons;
}

function protectionReasons(deployment, aliases, context) {
  const meta = deployment.meta ?? {};
  const reasons = [];
  if (aliases.some((alias) => CANONICAL_ALIASES.includes(alias))) reasons.push('canonical-alias');
  if (aliases.length > 0 && context.branches.has(meta.githubCommitRef))
    reasons.push('active-branch-alias');
  if (context.newestThree.has(deployment.uid)) reasons.push('open-pr-newest-three');
  if (context.heads.has(meta.githubCommitSha)) reasons.push('main-or-open-head');
  if (context.holds.has(deployment.uid)) reasons.push('explicit-hold');
  return reasons;
}

function lifecycleOf(deployment, context) {
  const meta = deployment.meta ?? {};
  const branchExists = context.branches.has(meta.githubCommitRef);
  if (!meta.githubPrId) return branchExists ? 'no-pr-branch-exists' : 'orphan';
  if (!context.prNumbers.has(meta.githubPrId)) return 'pr-closed-or-merged';
  return branchExists ? 'open-pr-older-generation' : 'open-pr-branch-gone';
}

function lifecycleUnknown(lifecycle, aliases) {
  if (lifecycle === 'no-pr-branch-exists') return ['no-pr-branch-exists'];
  if (lifecycle === 'orphan' && aliases.length > 0) return ['orphan-with-alias'];
  return [];
}

function verdictOf(protection, unknown) {
  if (protection.length > 0) return 'PROTECTED';
  return unknown.length > 0 ? 'UNKNOWN' : 'SAFE';
}

function classifyPreview(deployment, context) {
  const aliases = context.aliasesOf.get(deployment.uid) ?? [];
  const lifecycle = lifecycleOf(deployment, context);
  const protection = protectionReasons(deployment, aliases, context);
  const unknown = [...unknownReasons(deployment), ...lifecycleUnknown(lifecycle, aliases)];
  return {
    id: deployment.uid,
    verdict: verdictOf(protection, unknown),
    branch: deployment.meta?.githubCommitRef ?? null,
    pr: deployment.meta?.githubPrId ?? null,
    sha: (deployment.meta?.githubCommitSha ?? '').slice(0, 8),
    aliases,
    lifecycle,
    reasons: [...protection, ...unknown],
  };
}

export function classify(world) {
  const production = world.deployments.filter(isProductionClass);
  const previews = world.deployments.filter((deployment) => !isProductionClass(deployment));
  const context = {
    aliasesOf: aliasesByDeployment(world.aliases),
    branches: world.branches,
    prNumbers: new Set(world.prs.map((pr) => String(pr.number))),
    heads: new Set([world.main, ...world.prs.map((pr) => pr.headRefOid)]),
    newestThree: newestThreeOfOpenPrs(world.prs, previews),
    holds: world.holds,
  };
  return {
    production,
    previews,
    rows: previews.map((deployment) => classifyPreview(deployment, context)),
  };
}
