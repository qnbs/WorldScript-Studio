import {
  assertOrigin,
  assertProduction,
  assertRequiredRuns,
  isProductionOn,
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
import {
  CANONICAL_ALIASES,
  CANONICAL_URL,
  MAX_DELETIONS,
  PAUSE_MS,
  TERMINAL_STATES,
} from './scope.mjs';
import { refuse } from './util.mjs';

// QNBS-v3: main is read before and after the provider reads so a merge landing mid-read cannot give the snapshot an anchor it does not belong to.
export async function readWorld(deps) {
  assertOrigin(deps);
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

// QNBS-v3: an ID whose verdict changed before its turn is only deferred, but if it is still present it joins the set the post-proof must find intact, with its live aliases and state, because a deployment that became protected or unclear must not vanish, lose its alias or deteriorate unnoticed.
function defer(session, live, id, row) {
  session.summary.reclassified.push(id);
  if (!live.deployments.some((deployment) => deployment.uid === id)) return;
  session.keep.add(id);
  if (row) session.deferred.push(row);
}

// QNBS-v3: a failed alias removal may still have landed (a timeout after the provider acted), so the binding is re-read; an alias that is gone settles the write without a retry, one that is still bound stops the pass.
async function removeBoundAlias(session, host, id) {
  const { deps } = session;
  if (attempt(session, () => removeAlias(deps, host))) return;
  const bound = (await listAliases(deps)).some(
    (entry) => entry.alias === host && entry.deploymentId === id,
  );
  if (bound) refuse('alias-remove-failed');
}

// QNBS-v3: every deletion re-reads main, the gates and the whole provider state first; a changed verdict only defers the ID, a failed or unconfirmed write stops the run and is never retried.
async function retire(session, id) {
  const { deps, anchor, summary } = session;
  const live = await readWorld(deps);
  if (live.main !== anchor) refuse('main-moved');
  verifyGates(deps, live);
  const row = classify(live).rows.find((candidate) => candidate.id === id);
  if (row?.verdict !== 'SAFE') return defer(session, live, id, row);
  for (const host of row.aliases) {
    assertBoundAlias(live, host, id);
    await removeBoundAlias(session, host, id);
  }
  const written = attempt(session, () => removeDeployment(deps, id));
  await deps.sleep(PAUSE_MS);
  if (!(await absent(deps, id))) refuse(written ? 'delete-not-confirmed' : 'delete-failed');
  session.erased.push(live.deployments.find((deployment) => deployment.uid === id));
  return summary.deleted.push(id);
}

const holdsBinding = (after) => (binding) =>
  after.aliases.some((alias) => alias.alias === binding.host && alias.deploymentId === binding.id);

const holdsState = (after) => (row) =>
  after.deployments.find((deployment) => deployment.uid === row.id)?.readyState === row.state;

// QNBS-v3: the same predicate that authorized the pass (target, READY, the anchored commit, project and repository identity) is applied again to the very deployment the pass started from.
const isReadyProduction = (after, session) => {
  const production = after.deployments.find(
    (deployment) => deployment.uid === session.summary.productionId,
  );
  return production !== undefined && isProductionOn(session.anchor)(production);
};

// QNBS-v3: previews the pass keeps (planned or deferred) are the rows whose aliases and settled states the post-proof compares; a state that was still moving at plan time is not compared.
function keptRows(session, plan) {
  return [...plan.rows.filter((row) => row.verdict !== 'SAFE'), ...session.deferred];
}

const bindingsOf = (rows) =>
  rows.flatMap((row) => row.aliases.map((host) => ({ host, id: row.id })));

function requiredPresent(session, plan) {
  const ids = plan.production.map((deployment) => deployment.uid);
  const kept = keptRows(session, plan).map((row) => row.id);
  return new Set([...ids, ...kept, ...session.keep]);
}

// QNBS-v3: the Production-class set must be exactly the planned one: a promotion or rollback that started during the wave adds to it, and a rollback flag that was lost removes from it; neither is something this pass may declare complete over.
function productionSetStable(after, plan) {
  const ids = (deployments) =>
    deployments
      .map((deployment) => deployment.uid)
      .sort()
      .join();
  return ids(classify(after).production) === ids(plan.production);
}

// QNBS-v3: a PR can reopen or a branch reappear after a preview's turn; the deleted records are classified again against the final snapshot, and any that would now be protected or unclear fail the proof, because the pass can no longer undo that deletion but must not report it as clean.
function deletionsStillSafe(after, session) {
  if (session.erased.length === 0) return true;
  const world = { ...after, deployments: [...after.deployments, ...session.erased] };
  const erased = new Set(session.erased.map((deployment) => deployment.uid));
  return classify(world)
    .rows.filter((row) => erased.has(row.id))
    .every((row) => row.verdict === 'SAFE');
}

const proofHolds = (proof, lost) =>
  [
    lost.length === 0,
    proof.deletedAbsent,
    proof.canonicalAliasesBound,
    proof.protectedAliasesBound,
    proof.previewStatesHeld,
    proof.deletionsStillSafe,
    proof.productionSetStable,
    proof.productionReady,
    proof.httpProduction === '200',
  ].every(Boolean);

// QNBS-v3: the post-proof re-asserts the anchor, the anchored gates and that Production itself is still the same READY deployment, and compares every alias binding and settled state of a kept preview captured before the wave; deleting previews must never be the last thing checked before declaring the pass complete.
async function postProof(session, plan) {
  const { deps, summary } = session;
  const after = await readWorld(deps);
  if (after.main !== summary.anchor) refuse('main-moved');
  assertRequiredRuns(deps, summary.anchor);
  const kept = keptRows(session, plan);
  const required = requiredPresent(session, plan);
  const present = new Set(after.deployments.map((deployment) => deployment.uid));
  const lost = [...required].filter((id) => !present.has(id));
  const canonical = CANONICAL_ALIASES.map((host) => ({ host, id: summary.productionId }));
  summary.postproof = {
    protectedPresent: `${required.size - lost.length}/${required.size}`,
    deletedAbsent: summary.deleted.every((id) => !present.has(id)),
    canonicalAliasesBound: canonical.every(holdsBinding(after)),
    protectedAliasesBound: bindingsOf(kept).every(holdsBinding(after)),
    previewStatesHeld: kept
      .filter((row) => TERMINAL_STATES.has(row.state))
      .every(holdsState(after)),
    deletionsStillSafe: deletionsStillSafe(after, session),
    productionSetStable: productionSetStable(after, plan),
    productionReady: isReadyProduction(after, session),
    httpProduction: deps.http(CANONICAL_URL),
  };
  if (!proofHolds(summary.postproof, lost)) refuse('postproof-failed');
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
      await reconcileSafe(
        { deps, anchor: world.main, summary, keep: new Set(), deferred: [], erased: [] },
        plan,
      );
    return summary;
  } catch (error) {
    summary.stop = error.reason ?? 'unexpected-error';
    throw Object.assign(new Error(summary.stop), { reason: summary.stop, summary });
  } finally {
    release();
  }
}
