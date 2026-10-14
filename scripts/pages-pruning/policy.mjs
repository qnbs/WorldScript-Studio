import {
  anyOf,
  latestStatus,
  newestSuccess,
  rank,
  refuse,
  timestamp,
  validId,
} from './evidence.mjs';

export const REPOSITORY = 'qnbs/WorldScript-Studio';
export const ROOT = `/repos/${REPOSITORY}`;
export const SITE = 'https://qnbs.github.io/WorldScript-Studio/';
export const WORKFLOW = `${REPOSITORY}/.github/workflows/prune-deployments.yml@refs/heads/main`;
export const MAX_BATCH = 10;
export const ACTIONS_BOT = 'github-actions[bot]';
// QNBS-v3: GitHub offers no compare-and-delete; this reviewed change admits scheduled main runs to write under the bounded writer fence in docs/PAGES-DEPLOYMENT-RECORD-PRUNING.md (#1028), and the job token carries deployments:write exactly while this is true.
export const DESTRUCTIVE_WRITES_ADMITTED = true;

const FULL_SHA = /^[a-f0-9]{40}$/;
const JOB_URL =
  /^https:\/\/github\.com\/qnbs\/WorldScript-Studio\/actions\/runs\/(\d+)\/job\/(\d+)$/;
const ACTIONS_APP_ID = 15368;
const SETTLED = new Set(['success', 'inactive', 'failure', 'error']);
const MODES = new Map([
  ['schedule', 'delete'],
  ['workflow_dispatch', 'dry-run'],
]);

const trusted = (authority) =>
  [
    authority.repository === REPOSITORY,
    authority.ref === 'refs/heads/main',
    authority.workflowRef === WORKFLOW,
    FULL_SHA.test(authority.sha ?? ''),
  ].every(Boolean);

export function admission(authority) {
  return trusted(authority) ? (MODES.get(authority.eventName) ?? 'refused') : 'refused';
}

const isIdList = (value) => Array.isArray(value) && value.every(validId);

export function validateHolds(holds) {
  const keys = holds && typeof holds === 'object' ? Object.keys(holds).sort().join(',') : '';
  if (keys !== 'evidence,rollback') refuse('invalid-holds');
  if (!isIdList(holds.evidence) || !isIdList(holds.rollback)) refuse('invalid-holds');
  return new Set([...holds.evidence, ...holds.rollback]);
}

export const creatorLogin = (actor) =>
  typeof actor?.login === 'string' && actor.login !== '' ? actor.login : null;

// QNBS-v3: an author is bound by account id and login together; a payload without a valid id, a reused login or a renamed account never matches another author.
export function actorKey(actor) {
  const login = creatorLogin(actor);
  return login !== null && validId(actor.id) ? `${actor.id}:${login}` : null;
}

const isActionsApp = (app) => app.id === ACTIONS_APP_ID && app.slug === 'github-actions';
const appIsActionsOrAbsent = (app) => app == null || isActionsApp(app);

// QNBS-v3: bot-triggered pushes carry no GitHub App on the deployment, so identity is proven against the run actor later, not by the app id.
export function owned(record) {
  const creator = creatorLogin(record.creator);
  return [
    record.environment === 'github-pages',
    record.ref === 'main',
    record.task === 'deploy',
    FULL_SHA.test(record.sha ?? ''),
    record.transient_environment === false,
    record.production_environment === false,
    appIsActionsOrAbsent(record.performed_via_github_app),
    creator !== null,
    creator !== ACTIONS_BOT,
  ].every(Boolean);
}

export function jobIdentity(status) {
  const match = JOB_URL.exec(status?.log_url ?? '');
  if (!match) return null;
  const identity = { run: Number(match[1]), job: Number(match[2]) };
  return validId(identity.run) && validId(identity.job) ? identity : null;
}

export const isPagesStatus = (status) =>
  status?.environment === 'github-pages' && status?.environment_url === SITE;

function assertStatuses(statuses, seen) {
  for (const status of statuses) {
    if (anyOf(!validId(status.id), seen.has(status.id), !timestamp(status.created_at)))
      refuse('invalid-statuses');
    seen.add(status.id);
  }
}

export function assertInventory(records) {
  const ids = new Set();
  const statusIds = new Set();
  for (const record of records) {
    if (anyOf(!validId(record.id), ids.has(record.id), !timestamp(record.created_at)))
      refuse('invalid-inventory');
    ids.add(record.id);
    if (!Array.isArray(record.statuses)) refuse('incomplete-statuses');
    assertStatuses(record.statuses, statusIds);
  }
}

const isPages = (record) => record.environment === 'github-pages';

export function publicationOrder(records) {
  return records
    .filter(isPages)
    .flatMap((record) => {
      const status = newestSuccess(record);
      return status ? [{ record, status }] : [];
    })
    .sort((a, b) => rank(a.status, b.status));
}

function hasPagesProvenance({ record, success, latest }) {
  return [
    owned(record),
    isPagesStatus(success),
    latest?.environment === 'github-pages',
    jobIdentity(success) !== null,
  ].every(Boolean);
}

const PROTECTIONS = [
  ['other-environment', ({ record }) => !isPages(record)],
  ['newest-three', ({ record, newest }) => newest.has(record.id)],
  ['current-or-rollback', ({ record, slotIds }) => slotIds.has(record.id)],
  ['unproved-publication', ({ record, unproved }) => unproved.has(record.id)],
  ['explicit-hold', ({ record, held }) => held.has(record.id)],
  ['unknown-ownership', (entry) => !hasPagesProvenance(entry)],
  ['unsafe-status', ({ latest }) => !['success', 'inactive'].includes(latest?.state)],
];

function classify(record, context) {
  const entry = {
    ...context,
    record,
    success: context.successes.get(record.id),
    latest: latestStatus(record),
  };
  const reasons = PROTECTIONS.filter(([, applies]) => applies(entry)).map(([reason]) => reason);
  return { record, reasons };
}

const shapeSlots = (ordered) => ({
  current: ordered[0]?.record.id ?? null,
  rollback: ordered[1]?.record.id ?? null,
  unproved: [],
});

function currentIsSettled(head) {
  if (!head) return false;
  return [
    owned(head.record),
    latestStatus(head.record)?.id === head.status.id,
    isPagesStatus(head.status),
    jobIdentity(head.status) !== null,
  ].every(Boolean);
}

const hasUnsettled = (pages) => pages.some((record) => !SETTLED.has(latestStatus(record)?.state));

// QNBS-v3: slots come from API-proven publications when supplied; the shape-only default exists for the pure plan and never authorizes a write alone.
export function planPruning(records, holds, { complete = true, slots } = {}) {
  if (!complete || !Array.isArray(records)) refuse('incomplete-inventory');
  const held = validateHolds(holds);
  assertInventory(records);
  const pages = records.filter(isPages).sort(rank);
  const ordered = publicationOrder(records);
  const chosen = slots ?? shapeSlots(ordered);
  const unsettled = anyOf(!currentIsSettled(ordered[0]), hasUnsettled(pages));
  const context = {
    held,
    newest: new Set(pages.slice(0, 3).map((record) => record.id)),
    slotIds: new Set([chosen.current, chosen.rollback].filter(validId)),
    unproved: new Set(chosen.unproved),
    successes: new Map(ordered.map(({ record, status }) => [record.id, status])),
  };
  const entries = records.map((record) => classify(record, context));
  return {
    current: chosen.current ?? null,
    rollback: chosen.rollback ?? null,
    protectedRecords: entries
      .filter((entry) => entry.reasons.length)
      .map(({ record, reasons }) => ({ id: record.id, reasons })),
    candidates: entries
      .filter((entry) => !entry.reasons.length)
      .map((entry) => entry.record)
      .sort(rank),
    blocked: pages.length > 3 && unsettled,
  };
}
