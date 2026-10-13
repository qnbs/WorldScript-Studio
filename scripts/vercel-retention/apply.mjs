import {
  assertProduction,
  assertRequiredRuns,
  readBranches,
  readMain,
  readOpenPrs,
} from './authority.mjs';
import { classify } from './classify.mjs';
import { readHolds } from './holds.mjs';
import {
  listAliases,
  listDeployments,
  readProject,
  removeAlias,
  removeDeployment,
} from './provider.mjs';
import { CANONICAL_ALIASES, CANONICAL_URL, MAX_DELETIONS, PAUSE_MS } from './scope.mjs';
import { refuse } from './util.mjs';

// QNBS-v3: main is read before and after the provider reads so a merge landing mid-read cannot give the snapshot an anchor it does not belong to.
export async function readWorld(deps) {
  const main = readMain(deps);
  await readProject(deps);
  const deployments = await listDeployments(deps);
  const aliases = await listAliases(deps);
  const world = {
    main,
    deployments,
    aliases,
    prs: readOpenPrs(deps),
    branches: readBranches(deps),
    holds: readHolds(deps),
  };
  if (readMain(deps) !== main) refuse('main-moved-during-read');
  return world;
}

function verifyGates(deps, world) {
  assertRequiredRuns(deps, world.main);
  return assertProduction(deps, world, world.main);
}

function newSummary(mode) {
  return {
    mode,
    anchor: null,
    productionId: null,
    protectedProduction: 0,
    rollbackCandidates: 0,
    protectedPreviews: 0,
    safe: 0,
    unknown: 0,
    deleted: [],
    reclassified: [],
    deferred: 0,
    writeAttempts: 0,
    stop: null,
    postproof: null,
    manifest: [],
  };
}

function fillCounts(summary, plan) {
  const count = (verdict) => plan.rows.filter((row) => row.verdict === verdict).length;
  summary.manifest = plan.rows.map((row) => ({ ...row, aliases: row.aliases.length }));
  summary.protectedProduction = plan.production.length;
  summary.rollbackCandidates = plan.production.filter((d) => d.isRollbackCandidate === true).length;
  summary.protectedPreviews = count('PROTECTED');
  summary.safe = count('SAFE');
  summary.unknown = count('UNKNOWN');
}

// QNBS-v3: raw tool errors can echo credentials, so a failed write is reduced to a boolean; validation refusals keep their fixed reason.
function attempt(session, write) {
  session.summary.writeAttempts += 1;
  try {
    write();
    return true;
  } catch (error) {
    if (error.reason) throw error;
    return false;
  }
}

async function absent(deps, id) {
  return !(await listDeployments(deps)).some((deployment) => deployment.uid === id);
}

function assertBoundAlias(live, host, id) {
  const entry = live.aliases.find((alias) => alias.alias === host);
  if (!entry || entry.deploymentId !== id) refuse('alias-binding-changed');
  if (CANONICAL_ALIASES.includes(host)) refuse('canonical-alias-targeted');
}

// QNBS-v3: every deletion re-reads main, the gates and the whole provider state first; a changed verdict only defers the ID, a failed or unconfirmed write stops the run and is never retried.
async function retire(session, id) {
  const { deps, anchor, summary } = session;
  const live = await readWorld(deps);
  if (live.main !== anchor) refuse('main-moved');
  verifyGates(deps, live);
  const row = classify(live).rows.find((candidate) => candidate.id === id);
  if (row?.verdict !== 'SAFE') return summary.reclassified.push(id);
  for (const host of row.aliases) {
    assertBoundAlias(live, host, id);
    if (!attempt(session, () => removeAlias(deps, host))) refuse('alias-remove-failed');
  }
  const written = attempt(session, () => removeDeployment(deps, id));
  await deps.sleep(PAUSE_MS);
  if (!(await absent(deps, id))) refuse(written ? 'delete-not-confirmed' : 'delete-failed');
  return summary.deleted.push(id);
}

// QNBS-v3: the post-proof re-asserts the anchored gates and that Production itself is still the same READY deployment, because deleting previews must never be the last thing checked before declaring the pass complete.
async function postProof(session, protectedIds) {
  const { deps, summary } = session;
  const after = await readWorld(deps);
  assertRequiredRuns(deps, summary.anchor);
  const production = after.deployments.find(
    (deployment) => deployment.uid === summary.productionId,
  );
  const productionReady = [production?.target === 'production', production?.readyState === 'READY'];
  const present = new Set(after.deployments.map((deployment) => deployment.uid));
  const lost = [...protectedIds].filter((id) => !present.has(id));
  const resurrected = summary.deleted.filter((id) => present.has(id));
  const bound = CANONICAL_ALIASES.every((host) =>
    after.aliases.some(
      (alias) => alias.alias === host && alias.deploymentId === summary.productionId,
    ),
  );
  const http = deps.http(CANONICAL_URL);
  const proof = {
    protectedPresent: `${protectedIds.size - lost.length}/${protectedIds.size}`,
    deletedAbsent: resurrected.length === 0,
    canonicalAliasesBound: bound,
    productionReady: productionReady.every(Boolean),
    httpProduction: http,
  };
  summary.postproof = proof;
  const sound = [
    lost.length === 0,
    proof.deletedAbsent,
    bound,
    proof.productionReady,
    http === '200',
  ];
  if (!sound.every(Boolean)) refuse('postproof-failed');
}

function protectedSet(plan) {
  const ids = plan.production.map((deployment) => deployment.uid);
  const kept = plan.rows.filter((row) => row.verdict !== 'SAFE').map((row) => row.id);
  return new Set([...ids, ...kept]);
}

async function reconcileSafe(session, plan) {
  const safe = plan.rows.filter((row) => row.verdict === 'SAFE').map((row) => row.id);
  session.summary.deferred = Math.max(0, safe.length - MAX_DELETIONS);
  for (const id of safe.slice(0, MAX_DELETIONS)) await retire(session, id);
  await postProof(session, protectedSet(plan));
}

export async function runRetention(deps, mode) {
  const summary = newSummary(mode);
  let release = () => {};
  try {
    if (mode === 'reconcile') release = deps.lock();
    const world = await readWorld(deps);
    summary.anchor = world.main;
    summary.productionId = verifyGates(deps, world);
    const plan = classify(world);
    fillCounts(summary, plan);
    if (mode === 'reconcile') await reconcileSafe({ deps, anchor: world.main, summary }, plan);
    return summary;
  } catch (error) {
    summary.stop = error.reason ?? 'unexpected-error';
    throw Object.assign(new Error(summary.stop), { reason: summary.stop, summary });
  } finally {
    release();
  }
}
