import { CANONICAL_ALIASES, SCOPE, TERMINAL_STATES } from './scope.mjs';
import { ALIAS_HOST, anyOf, FULL_SHA } from './util.mjs';

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

// QNBS-v3: the exact per-PR snapshot keeps the newest min(3, available) plain Previews of every open PR; a preview without a usable creation time, a custom environment or an unrecognized promotion substate is ranked out, because it is never deleted anyway and so must not displace a real, dated Preview from a retained slot.
function newestThreeOfOpenPrs(prs, previews) {
  const kept = new Set();
  for (const pr of prs) {
    const own = previews
      .filter((deployment) => deployment.meta?.githubPrId === String(pr.number))
      .filter(isRankable)
      .sort((a, b) => b.created - a.created)
      .slice(0, 3);
    for (const deployment of own) kept.add(deployment.uid);
  }
  return kept;
}

export function identityConfirmed(deployment) {
  const meta = deployment.meta ?? {};
  return [
    deployment.projectId === SCOPE.projectId,
    meta.githubOrg === SCOPE.org,
    meta.githubRepo === SCOPE.repo,
  ].every(Boolean);
}

// QNBS-v3: only a plain Preview (no target, or the literal preview target, and no custom environment id at all) is ever classified for deletion; a custom environment such as staging, or an environment id of any other kind, is UNKNOWN, never SAFE.
const isPlainPreview = (deployment) =>
  [
    [null, 'preview'].includes(deployment.target ?? null),
    [undefined, null].includes(deployment.customEnvironmentId),
  ].every(Boolean);

// QNBS-v3: STAGED is the only non-Production substate a Preview carries (PROMOTED and ROLLING are Production-class and never reach this point); any other value may be a promotion state this runner does not know.
const PREVIEW_SUBSTATES = new Set([undefined, null, 'STAGED']);
const hasKnownSubstate = (deployment) => PREVIEW_SUBSTATES.has(deployment.readySubstate);

const DAY_MS = 86_400_000;

// A creation time is a positive safe integer that is not in the future; -1, 0, 1.5 or an out-of-range value would pass a bare finiteness test.
export const validStamp = (value) =>
  Number.isSafeInteger(value) && value > 0 && value <= Date.now() + DAY_MS;

const isRankable = (deployment) =>
  [isPlainPreview(deployment), hasKnownSubstate(deployment), validStamp(deployment.created)].every(
    Boolean,
  );

const PR_ID = /^[1-9][0-9]*$/;
const isRef = (value) => typeof value === 'string' && value !== '';

// QNBS-v3: a PR identifier that is present but not a plain decimal string cannot be matched against the open-PR set, so it must not read as "closed or merged".
function prIdMalformed(deployment) {
  const id = deployment.meta?.githubPrId;
  if ([undefined, null, ''].includes(id)) return false;
  return typeof id !== 'string' || !PR_ID.test(id);
}

// QNBS-v3: each check names the reason it raises, so the list stays flat as checks are added and the reasons keep a fixed order.
const UNKNOWN_CHECKS = [
  ['target-unrecognized', (deployment) => !isPlainPreview(deployment)],
  ['substate-unrecognized', (deployment) => !hasKnownSubstate(deployment)],
  ['identity-unconfirmed', (deployment) => !identityConfirmed(deployment)],
  ['non-terminal-state', (deployment) => !TERMINAL_STATES.has(deployment.readyState)],
  ['rollback-unknown', (deployment) => typeof deployment.isRollbackCandidate !== 'boolean'],
  ['branch-unknown', (deployment) => !isRef(deployment.meta?.githubCommitRef)],
  ['pr-id-malformed', prIdMalformed],
  ['commit-unknown', (deployment) => !FULL_SHA.test(deployment.meta?.githubCommitSha ?? '')],
  ['created-unknown', (deployment) => !validStamp(deployment.created)],
];

const unknownReasons = (deployment) =>
  UNKNOWN_CHECKS.filter(([, raised]) => raised(deployment)).map(([reason]) => reason);

const FAILED_STATES = new Set(['ERROR', 'CANCELED']);

// QNBS-v3: a failed or canceled Preview is deletable only when no open PR and no existing branch still needs it, so such a Preview of a living branch or an open PR is protected whatever its PR lifecycle says.
function failedPreviewNeeded(deployment, context) {
  const meta = deployment.meta ?? {};
  const needed = [
    context.branches.has(meta.githubCommitRef),
    context.prNumbers.has(meta.githubPrId),
  ];
  return FAILED_STATES.has(deployment.readyState) && needed.some(Boolean);
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
  if (failedPreviewNeeded(deployment, context)) reasons.push('failed-preview-needed');
  return reasons;
}

function lifecycleOf(deployment, context) {
  const meta = deployment.meta ?? {};
  const branchExists = context.branches.has(meta.githubCommitRef);
  if (!meta.githubPrId) return branchExists ? 'no-pr-branch-exists' : 'orphan';
  if (!context.prNumbers.has(meta.githubPrId)) return 'pr-closed-or-merged';
  return branchExists ? 'open-pr-older-generation' : 'open-pr-branch-gone';
}

// QNBS-v3: an alias host the removal command would refuse (a custom domain, a nested label) makes the preview UNKNOWN up front, so a pass can never start on a deployment whose alias it is unable to remove.
function lifecycleUnknown(lifecycle, aliases) {
  const reasons = [];
  if (lifecycle === 'no-pr-branch-exists') reasons.push('no-pr-branch-exists');
  if (lifecycle === 'orphan' && aliases.length > 0) reasons.push('orphan-with-alias');
  if (aliases.some((host) => !ALIAS_HOST.test(host))) reasons.push('alias-host-unsupported');
  return reasons;
}

function verdictOf(protection, unknown) {
  if (protection.length > 0) return 'PROTECTED';
  return unknown.length > 0 ? 'UNKNOWN' : 'SAFE';
}

// QNBS-v3: the manifest names the state, target and age the gates looked at, so an operator can audit a verdict without the raw provider payload; creator metadata is never copied.
function evidenceOf(deployment) {
  const created = validStamp(deployment.created) ? new Date(deployment.created).toISOString() : '-';
  return {
    state: deployment.readyState ?? '-',
    target: deployment.target ?? 'preview',
    created,
  };
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
    ...evidenceOf(deployment),
    aliases,
    lifecycle,
    reasons: [...protection, ...unknown],
  };
}

export function classify(world) {
  const production = world.deployments.filter(isProductionClass);
  const previews = world.deployments.filter((deployment) => !isProductionClass(deployment));
  // QNBS-v3: a fork PR's head branch does not exist in this repository, so the open-PR snapshot counts as branch authority too.
  const context = {
    aliasesOf: aliasesByDeployment(world.aliases),
    branches: new Set([...world.branches, ...world.prs.map((pr) => pr.headRefName)]),
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
