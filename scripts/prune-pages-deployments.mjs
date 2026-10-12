import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const REPOSITORY = 'qnbs/WorldScript-Studio';
const ROOT = `/repos/${REPOSITORY}`;
const SITE = 'https://qnbs.github.io/WorldScript-Studio/';
const WORKFLOW = `${REPOSITORY}/.github/workflows/prune-deployments.yml@refs/heads/main`;
const MAX_BATCH = 10;
const validId = (id) => Number.isSafeInteger(id) && id > 0;
const timestamp = (value) => {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  )
    return false;
  const parsed = Date.parse(value);
  const canonical = value.length === 20 ? value.replace('Z', '.000Z') : value;
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === canonical;
};
const rank = (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id;
const refuse = (reason) => {
  throw Object.assign(new Error(reason), { reason });
};

export function admission({ repository, ref, sha, workflowRef, eventName }) {
  if (
    repository !== REPOSITORY ||
    ref !== 'refs/heads/main' ||
    workflowRef !== WORKFLOW ||
    !/^[a-f0-9]{40}$/.test(sha ?? '')
  )
    return 'refused';
  if (eventName === 'schedule') return 'delete';
  if (eventName === 'workflow_dispatch') return 'dry-run';
  return 'refused';
}

export function validateHolds(holds) {
  if (
    !holds ||
    Object.keys(holds).sort().join(',') !== 'evidence,rollback' ||
    !['evidence', 'rollback'].every((key) => Array.isArray(holds[key]) && holds[key].every(validId))
  )
    refuse('invalid-holds');
  return new Set([...holds.evidence, ...holds.rollback]);
}

function owned(record) {
  return (
    record.environment === 'github-pages' &&
    record.ref === 'main' &&
    record.task === 'deploy' &&
    /^[a-f0-9]{40}$/.test(record.sha ?? '') &&
    record.transient_environment === false &&
    record.production_environment === false &&
    record.performed_via_github_app?.id === 15368 &&
    record.performed_via_github_app?.slug === 'github-actions'
  );
}

function jobIdentity(status) {
  const match =
    /^https:\/\/github\.com\/qnbs\/WorldScript-Studio\/actions\/runs\/(\d+)\/job\/(\d+)$/.exec(
      status?.log_url ?? '',
    );
  return match?.slice(1).map(Number).every(validId)
    ? { run: Number(match[1]), job: Number(match[2]) }
    : null;
}

export function planPruning(records, holds, complete = true) {
  if (!complete || !Array.isArray(records)) refuse('incomplete-inventory');
  const held = validateHolds(holds);
  const ids = new Set();
  const statusIds = new Set();
  for (const record of records) {
    if (!validId(record.id) || ids.has(record.id) || !timestamp(record.created_at))
      refuse('invalid-inventory');
    ids.add(record.id);
    if (!Array.isArray(record.statuses)) refuse('incomplete-statuses');
    for (const status of record.statuses) {
      if (!validId(status.id) || statusIds.has(status.id) || !timestamp(status.created_at))
        refuse('invalid-statuses');
      statusIds.add(status.id);
    }
  }
  const pages = records.filter((record) => record.environment === 'github-pages').sort(rank);
  const latest = (record) => [...record.statuses].sort(rank)[0];
  const successful = pages
    .flatMap((record) => {
      const status = [...record.statuses].filter((item) => item.state === 'success').sort(rank)[0];
      return status ? [{ record, status }] : [];
    })
    .sort((a, b) => rank(a.status, b.status));
  // QNBS-v3: Pages leaves historical records at success; successful completion order protects the current and previous publication, independently of creation order.
  const current = successful[0];
  const rollback = successful[1];
  const currentProved =
    current &&
    owned(current.record) &&
    latest(current.record)?.id === current.status.id &&
    current.status.environment === 'github-pages' &&
    current.status.environment_url === SITE &&
    jobIdentity(current.status);
  const unsettled = pages.some(
    (record) => !['success', 'inactive', 'failure', 'error'].includes(latest(record)?.state),
  );
  const protectedRecords = [];
  const candidates = [];
  for (const record of records) {
    const status = latest(record);
    const success = successful.find((item) => item.record.id === record.id)?.status;
    const reasons = [];
    if (record.environment !== 'github-pages') reasons.push('other-environment');
    if (pages.slice(0, 3).some((item) => item.id === record.id)) reasons.push('newest-three');
    if ([current?.record.id, rollback?.record.id].includes(record.id))
      reasons.push('current-or-rollback');
    if (held.has(record.id)) reasons.push('explicit-hold');
    if (
      !owned(record) ||
      !success ||
      success.environment !== 'github-pages' ||
      status?.environment !== 'github-pages' ||
      success.environment_url !== SITE ||
      !jobIdentity(success)
    )
      reasons.push('unknown-ownership');
    if (!['success', 'inactive'].includes(status?.state)) reasons.push('unsafe-status');
    if (reasons.length) protectedRecords.push({ id: record.id, reasons });
    else candidates.push(record);
  }
  const blocked = pages.length > 3 && (!currentProved || unsettled);
  return {
    current: current?.record.id ?? null,
    protectedRecords,
    candidates: candidates.sort(rank),
    blocked,
  };
}

async function read(github, route, parameters, pause) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await github.request(`GET ${route}`, parameters);
    } catch (error) {
      const retryAfter = Number(error.response?.headers?.['retry-after']);
      const delay = error.status === 429 ? retryAfter * 1000 : 250 * 2 ** attempt;
      if (
        attempt === 2 ||
        ![429, 500, 502, 503, 504].includes(error.status) ||
        !Number.isFinite(delay) ||
        delay > 2000 ||
        delay < 0
      )
        throw error;
      await pause(delay);
    }
  }
}

async function collect(github, route, pause, maxPages = 20) {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const response = await read(github, route, { per_page: 100, page }, pause);
    if (!Array.isArray(response.data) || response.data.length > 100) refuse('invalid-page');
    all.push(...response.data);
    const next = /<([^>]+)>;\s*rel="next"/.exec(response.headers?.link ?? '');
    if (!next) {
      if (response.data.length < 100) return all;
      continue;
    }
    const url = new URL(next[1]);
    if (
      !response.data.length ||
      url.origin !== 'https://api.github.com' ||
      url.pathname !== route.split('?')[0] ||
      url.searchParams.get('page') !== String(page + 1) ||
      url.searchParams.get('per_page') !== '100'
    )
      refuse('invalid-pagination-link');
  }
  refuse('pagination-limit');
}

async function inventory(github, pause) {
  const response = await read(github, `${ROOT}/pages`, {}, pause);
  if (response.data.build_type !== 'workflow' || response.data.html_url !== SITE)
    refuse('unknown-pages-site');
  const records = await collect(github, `${ROOT}/deployments?environment=github-pages`, pause);
  for (const record of records) {
    if (!validId(record.id)) refuse('invalid-inventory');
    record.statuses = await collect(github, `${ROOT}/deployments/${record.id}/statuses`, pause, 5);
  }
  return records;
}

async function provePublication(github, record, pause) {
  const success = [...record.statuses].filter((status) => status.state === 'success').sort(rank)[0];
  const identity = jobIdentity(success);
  if (!identity) refuse('unknown-publication');
  const { data: run } = await read(github, `${ROOT}/actions/runs/${identity.run}`, {}, pause);
  const { data: job } = await read(github, `${ROOT}/actions/jobs/${identity.job}`, {}, pause);
  if (
    run.id !== identity.run ||
    run.repository?.full_name !== REPOSITORY ||
    run.head_repository?.full_name !== REPOSITORY ||
    run.name !== 'CI / CD' ||
    run.path !== '.github/workflows/ci.yml' ||
    run.event !== 'push' ||
    run.head_branch !== 'main' ||
    run.head_sha !== record.sha ||
    run.status !== 'completed' ||
    run.conclusion !== 'success' ||
    job.id !== identity.job ||
    job.run_id !== run.id ||
    job.name !== '🚀 Deploy to GitHub Pages' ||
    job.status !== 'completed' ||
    job.conclusion !== 'success' ||
    !job.steps?.some(
      (step) => step.name === 'Deploy to GitHub Pages' && step.conclusion === 'success',
    )
  )
    refuse('unknown-publication');
}

const fingerprint = (record) =>
  JSON.stringify({
    id: record.id,
    sha: record.sha,
    ref: record.ref,
    environment: record.environment,
    created_at: record.created_at,
    task: record.task,
    transient_environment: record.transient_environment,
    production_environment: record.production_environment,
    app: record.performed_via_github_app,
    statuses: [...record.statuses].sort(rank),
  });

export async function reconcilePages({
  github,
  authority,
  holds,
  dryRun = false,
  pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const admitted = admission(authority);
  const result = {
    trigger: authority.eventName,
    mode: dryRun ? 'dry-run' : admitted,
    queried: 0,
    classified: 0,
    protected: 0,
    candidate: 0,
    attempted: 0,
    inactivated: 0,
    deleted: 0,
    failed: 0,
    skipped: 0,
    reasons: {},
    current: null,
    manifest: [],
    followUpRequired: false,
  };
  let considered = 0;
  const reason = (key, count = 1) => {
    result.reasons[key] = (result.reasons[key] ?? 0) + count;
  };
  try {
    if (admitted === 'refused') refuse('untrusted-trigger');
    const records = await inventory(github, pause);
    result.queried = records.length;
    const plan = planPruning(records, holds);
    result.classified = records.length;
    result.protected = plan.protectedRecords.length;
    result.candidate = plan.candidates.length;
    result.current = plan.current;
    result.manifest = plan.protectedRecords
      .map((record) => ({ ...record, disposition: 'protected' }))
      .concat(
        plan.candidates.map((record) => ({ id: record.id, disposition: 'candidate', reasons: [] })),
      );
    for (const record of plan.protectedRecords) for (const key of record.reasons) reason(key);
    if (plan.blocked) refuse('unproved-current-or-unsettled');
    if (plan.current)
      await provePublication(
        github,
        records.find((record) => record.id === plan.current),
        pause,
      );
    for (const candidate of plan.candidates.slice(0, MAX_BATCH))
      await provePublication(github, candidate, pause);
    if (result.mode === 'dry-run') {
      result.skipped = plan.candidates.length;
      if (result.skipped) reason('dry-run', result.skipped);
      result.followUpRequired = records.length > 3;
      return result;
    }
    // QNBS-v3: holds are immutable at the executing main SHA; a new main commit invalidates admission before each mutation.
    const revalidate = async (candidate, expected) => {
      const fresh = await inventory(github, pause);
      const next = planPruning(fresh, holds);
      const record = fresh.find((item) => item.id === candidate.id);
      if (next.blocked || next.current !== plan.current) refuse('current-moved');
      if (
        !record ||
        !next.candidates.some((item) => item.id === candidate.id) ||
        fingerprint(record) !== expected
      )
        return null;
      await provePublication(
        github,
        fresh.find((item) => item.id === next.current),
        pause,
      );
      await provePublication(github, record, pause);
      const { data: branch } = await read(github, `${ROOT}/branches/main`, {}, pause);
      if (branch.commit?.sha !== authority.sha) refuse('main-moved');
      return record;
    };
    for (const candidate of plan.candidates.slice(0, MAX_BATCH)) {
      considered++;
      let fresh = await revalidate(candidate, fingerprint(candidate));
      if (!fresh) {
        result.skipped++;
        reason('stale-candidate');
        continue;
      }
      result.attempted++;
      const latest = [...fresh.statuses].sort(rank)[0];
      if (latest.state !== 'inactive') {
        const { data: inactive } = await github.request(
          `POST ${ROOT}/deployments/${candidate.id}/statuses`,
          {
            state: 'inactive',
            environment: 'github-pages',
            environment_url: SITE,
            log_url: latest.log_url,
            auto_inactive: false,
          },
        );
        if (
          !validId(inactive.id) ||
          inactive.state !== 'inactive' ||
          !timestamp(inactive.created_at)
        )
          refuse('invalid-inactivation-response');
        result.inactivated++;
        fresh.statuses.push(inactive);
        fresh = await revalidate(candidate, fingerprint(fresh));
        if (!fresh) {
          result.skipped++;
          reason('status-moved');
          continue;
        }
      }
      // QNBS-v3: failed/ambiguous POST never reaches DELETE; writes are never retried against an assumed inventory.
      await github.request(`DELETE ${ROOT}/deployments/${candidate.id}`);
      result.deleted++;
    }
    result.followUpRequired = records.length - result.deleted > 3;
    if (plan.candidates.length > MAX_BATCH)
      reason('batch-limit', plan.candidates.length - MAX_BATCH);
  } catch (error) {
    result.failed++;
    result.followUpRequired = true;
    reason(
      error.reason ??
        ([404, 409, 429, 500, 502, 503, 504].includes(error.status)
          ? `api-${error.status}`
          : 'api-or-inventory-error'),
    );
    if (result.candidate > considered) reason('aborted-batch', result.candidate - considered);
  }
  result.skipped += result.candidate - considered;
  return result;
}

export async function runAction({ github, context, core, holds, workflowRef }) {
  const result = await reconcilePages({
    github,
    holds,
    authority: {
      repository: `${context.repo.owner}/${context.repo.repo}`,
      eventName: context.eventName,
      ref: context.ref,
      sha: context.sha,
      workflowRef,
    },
  });
  const { manifest, ...summary } = result;
  core.info(JSON.stringify(summary));
  await core.summary
    .addHeading('GitHub Pages record reconciliation')
    .addCodeBlock(JSON.stringify(summary, null, 2), 'json')
    .addCodeBlock(JSON.stringify(manifest, null, 2), 'json')
    .write();
  if (result.failed)
    core.setFailed('Pages reconciliation failed closed; inspect sanitized counts and reasons.');
}

// QNBS-v3: the local CLI exposes GET only and forces dry-run; credentials never appear in output or request errors.
async function localDryRun() {
  if (process.argv.length !== 3 || process.argv[2] !== '--dry-run') refuse('invalid-cli-mode');
  const token = execFileSync('gh', ['auth', 'token'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  const github = {
    request: async (route, params = {}) => {
      if (!route.startsWith('GET ')) refuse('local-writes-forbidden');
      const url = new URL(`https://api.github.com${route.slice(4)}`);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
      const response = await fetch(url, {
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok)
        throw Object.assign(new Error('GitHub read failed'), {
          status: response.status,
          response: { headers: Object.fromEntries(response.headers) },
        });
      return { data: await response.json(), headers: Object.fromEntries(response.headers) };
    },
  };
  const result = await reconcilePages({
    github,
    holds: JSON.parse(
      readFileSync(new URL('../.github/pages-pruning-holds.json', import.meta.url), 'utf8'),
    ),
    dryRun: true,
    authority: {
      repository: REPOSITORY,
      ref: 'refs/heads/main',
      sha: '0'.repeat(40),
      workflowRef: WORKFLOW,
      eventName: 'workflow_dispatch',
    },
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.failed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  localDryRun().catch(() => {
    process.stderr.write('Read-only Pages inventory failed.\n');
    process.exitCode = 1;
  });
}
