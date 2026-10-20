// Bounded retention for the GitHub deployment records that Vercel for GitHub creates
// (environments `Production` and `Preview`, creator `vercel[bot]`). Vercel keeps adding one
// record per deployment and has no setting to stop it. This keeps the newest records per
// environment, the record of the current `main` commit and every Preview record of an open
// PR head; `github-pages` and every other environment or creator are out of scope and never
// read for deletion. Writes happen only on the scheduled run; a dispatched run plans only.

export const REPOSITORY = 'qnbs/WorldScript-Studio';
export const KEEP_PER_ENVIRONMENT = 10;
export const MAX_DELETES_PER_RUN = 40;
export const ENVIRONMENTS = Object.freeze(['Production', 'Preview']);
export const CREATOR = 'vercel[bot]';
const MAX_PAGES = 20;

export function refuse(reason) {
  throw Object.assign(new Error(reason), { reason });
}

function validRecord(record) {
  return (
    Number.isSafeInteger(record?.id) &&
    typeof record.environment === 'string' &&
    /^[0-9a-f]{40}$/.test(record.sha ?? '') &&
    typeof record.created_at === 'string' &&
    !Number.isNaN(Date.parse(record.created_at)) &&
    typeof record.creator?.login === 'string'
  );
}

// Pure classification. A malformed record anywhere in scope refuses the whole plan.
export function planRecords({ records, mainSha, openHeads, keep = KEEP_PER_ENVIRONMENT }) {
  if (!/^[0-9a-f]{40}$/.test(mainSha ?? '')) refuse('main-sha-invalid');
  const kept = [];
  const candidates = [];
  for (const environment of ENVIRONMENTS) {
    const scoped = records.filter(
      (record) => record?.environment === environment && record?.creator?.login === CREATOR,
    );
    if (!scoped.every(validRecord)) refuse('record-malformed');
    scoped.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id);
    scoped.forEach((record, index) => {
      const protectedRecord =
        index < keep ||
        record.sha === mainSha ||
        (environment === 'Preview' && openHeads.has(record.sha));
      (protectedRecord ? kept : candidates).push(record);
    });
  }
  // Oldest first, so a bounded pass removes the longest-retired records.
  candidates.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id);
  return { kept, candidates };
}

export function admission({ repository, ref, eventName }) {
  if (repository !== REPOSITORY) refuse('repository-unexpected');
  if (ref !== 'refs/heads/main') refuse('ref-unexpected');
  return { writes: eventName === 'schedule' };
}

async function readAll(github, route, params) {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data } = await github.request(route, { ...params, per_page: 100, page });
    if (!Array.isArray(data)) refuse('inventory-malformed');
    all.push(...data);
    if (data.length < 100) return all;
  }
  refuse('inventory-too-large');
}

export async function reconcileVercelRecords({
  github,
  authority,
  maxDeletes = MAX_DELETES_PER_RUN,
}) {
  const { writes } = admission(authority);
  const [owner, repo] = REPOSITORY.split('/');
  const base = { owner, repo };
  const records = await readAll(github, 'GET /repos/{owner}/{repo}/deployments', base);
  const pulls = await readAll(github, 'GET /repos/{owner}/{repo}/pulls', {
    ...base,
    state: 'open',
  });
  const { data: head } = await github.request('GET /repos/{owner}/{repo}/commits/{ref}', {
    ...base,
    ref: 'main',
  });
  const openHeads = new Set(pulls.map((pull) => pull?.head?.sha).filter(Boolean));
  const { kept, candidates } = planRecords({ records, mainSha: head?.sha, openHeads });
  const summary = {
    writes,
    inventory: records.length,
    kept: kept.length,
    candidates: candidates.length,
    deleted: [],
    failed: false,
    reason: null,
  };
  if (!writes) return summary;
  for (const record of candidates.slice(0, maxDeletes)) {
    const params = { ...base, deployment_id: record.id };
    try {
      const { data: current } = await github.request(
        'GET /repos/{owner}/{repo}/deployments/{deployment_id}',
        params,
      );
      if (
        current?.environment !== record.environment ||
        current?.sha !== record.sha ||
        current?.creator?.login !== CREATOR
      )
        refuse('record-changed');
      const { data: statuses } = await github.request(
        'GET /repos/{owner}/{repo}/deployments/{deployment_id}/statuses',
        { ...params, per_page: 1 },
      );
      if (statuses?.[0]?.state !== 'inactive')
        await github.request('POST /repos/{owner}/{repo}/deployments/{deployment_id}/statuses', {
          ...params,
          state: 'inactive',
        });
      await github.request('DELETE /repos/{owner}/{repo}/deployments/{deployment_id}', params);
      summary.deleted.push(record.id);
    } catch (error) {
      summary.failed = true;
      summary.reason = error?.reason ?? 'request-failed';
      break;
    }
  }
  if (!summary.failed && candidates.length > maxDeletes) summary.reason = 'batch-limit';
  return summary;
}

export async function runAction({ github, context, core, reconcile = reconcileVercelRecords }) {
  const summary = await reconcile({
    github,
    authority: {
      repository: `${context.repo.owner}/${context.repo.repo}`,
      ref: context.ref,
      eventName: context.eventName,
    },
  });
  core.info(JSON.stringify(summary));
  await core.summary
    .addHeading('Vercel GitHub deployment record retention')
    .addCodeBlock(JSON.stringify(summary, null, 2), 'json')
    .write();
  if (summary.failed) core.setFailed(`Vercel record retention stopped: ${summary.reason}`);
}
