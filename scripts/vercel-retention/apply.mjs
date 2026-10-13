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
  summary.manifest = plan.rows;
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

// QNBS-v3: an ID whose verdict changed before its turn is only deferred, but if it is still present it joins the set the post-proof must find intact, because a deployment that became protected or unclear must not vanish unnoticed.
function defer(session, live, id) {
  session.summary.reclassified.push(id);
  if (live.deployments.some((deployment) => deployment.uid === id)) session.keep.add(id);
}

// QNBS-v3: every deletion re-reads main, the gates and the whole provider state first; a changed verdict only defers the ID, a failed or unconfirmed write stops the run and is never retried.
async function retire(session, id) {
  const { deps, anchor, summary } = session;
  const live = await readWorld(deps);
  if (live.main !== anchor) refuse('main-moved');
  verifyGates(deps, live);
  const row = classify(live).rows.find((candidate) => candidate.id === id);
  if (row?.verdict !== 'SAFE') return defer(session, live, id);
  for (const host of row.aliases) {
    assertBoundAlias(live, host, id);
    if (!attempt(session, () => removeAlias(deps, host))) refuse('alias-remove-failed');
  }
  const written = attempt(session, () => removeDeployment(deps, id));
  await deps.sleep(PAUSE_MS);
  if (!(await absent(deps, id))) refuse(written ? 'delete-not-confirmed' : 'delete-failed');
  return summary.deleted.push(id);
}

const holdsBinding = (after) => (binding) =>
  after.aliases.some((alias) => alias.alias === binding.host && alias.deploymentId === binding.id);

const isReadyProduction = (after, id) => {
  const production = after.deployments.find((deployment) => deployment.uid === id);
  return [production?.target === 'production', production?.readyState === 'READY'].every(Boolean);
};

const proofHolds = (proof, lost) =>
  [
    lost.length === 0,
    proof.deletedAbsent,
    proof.canonicalAliasesBound,
    proof.protectedAliasesBound,
    proof.productionReady,
    proof.httpProduction === '200',
  ].every(Boolean);

// QNBS-v3: the post-proof re-asserts the anchor, the anchored gates and that Production itself is still the same READY deployment, and compares every alias binding of a kept deployment captured before the wave; deleting previews must never be the last thing checked before declaring the pass complete.
async function postProof(session, plan) {
  const { deps, summary } = session;
  const after = await readWorld(deps);
  if (after.main !== summary.anchor) refuse('main-moved');
  assertRequiredRuns(deps, summary.anchor);
  const required = requiredPresent(session, plan);
  const present = new Set(after.deployments.map((deployment) => deployment.uid));
  const lost = [...required].filter((id) => !present.has(id));
  const canonical = CANONICAL_ALIASES.map((host) => ({ host, id: summary.productionId }));
  summary.postproof = {
    protectedPresent: `${required.size - lost.length}/${required.size}`,
    deletedAbsent: summary.deleted.every((id) => !present.has(id)),
    canonicalAliasesBound: canonical.every(holdsBinding(after)),
    protectedAliasesBound: keptBindings(plan).every(holdsBinding(after)),
    productionReady: isReadyProduction(after, summary.productionId),
    httpProduction: deps.http(CANONICAL_URL),
  };
  if (!proofHolds(summary.postproof, lost)) refuse('postproof-failed');
}

// QNBS-v3: the aliases of deployments the pass keeps are snapshotted from the plan, so an alias that disappears or is rebound during the wave is caught even when its deployment is still present.
function keptBindings(plan) {
  return plan.rows
    .filter((row) => row.verdict !== 'SAFE')
    .flatMap((row) => row.aliases.map((host) => ({ host, id: row.id })));
}

function requiredPresent(session, plan) {
  const ids = plan.production.map((deployment) => deployment.uid);
  const kept = plan.rows.filter((row) => row.verdict !== 'SAFE').map((row) => row.id);
  return new Set([...ids, ...kept, ...session.keep]);
}

async function reconcileSafe(session, plan) {
  const safe = plan.rows.filter((row) => row.verdict === 'SAFE').map((row) => row.id);
  session.summary.deferred = Math.max(0, safe.length - MAX_DELETIONS);
  for (const id of safe.slice(0, MAX_DELETIONS)) await retire(session, id);
  await postProof(session, plan);
}

export async function runRetention(deps, mode, announce = () => {}) {
  const summary = newSummary(mode);
  let release = () => {};
  try {
    if (mode === 'reconcile') release = deps.lock();
    const world = await readWorld(deps);
    summary.anchor = world.main;
    summary.productionId = verifyGates(deps, world);
    const plan = classify(world);
    fillCounts(summary, plan);
    announce(summary);
    if (mode === 'reconcile')
      await reconcileSafe({ deps, anchor: world.main, summary, keep: new Set() }, plan);
    return summary;
  } catch (error) {
    summary.stop = error.reason ?? 'unexpected-error';
    throw Object.assign(new Error(summary.stop), { reason: summary.stop, summary });
  } finally {
    release();
  }
}
