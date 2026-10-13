import assert from 'node:assert/strict';
import { REPOSITORY, reconcilePages } from '../../../../scripts/prune-pages-deployments.mjs';

export const ROOT = `/repos/${REPOSITORY}`;
export const SITE = 'https://qnbs.github.io/WorldScript-Studio/';
export const REPO_ID = 4242;
export const ACTOR = 'maintainer';
// A principal is the account id and the login together; the publication proof matches both.
export const PRINCIPAL = { login: ACTOR, id: 9001 };
// The principal the pruning workflow's own token writes as.
const WORKFLOW_BOT = { login: 'github-actions[bot]', id: 41898282 };
export const date = (id) => new Date(Date.UTC(2026, 0, 1) + id * 1000).toISOString();
export const authority = {
  repository: REPOSITORY,
  ref: 'refs/heads/main',
  sha: 'a'.repeat(40),
  workflowRef: `${REPOSITORY}/.github/workflows/prune-deployments.yml@refs/heads/main`,
  eventName: 'schedule',
};
export const holds = { rollback: [], evidence: [] };

export const jobUrl = (id) =>
  `https://github.com/${REPOSITORY}/actions/runs/${1000 + id}/job/${2000 + id}`;

export function status(id, overrides = {}) {
  return {
    id: 100 + id,
    created_at: date(id),
    state: 'success',
    environment: 'github-pages',
    environment_url: SITE,
    creator: PRINCIPAL,
    log_url: jobUrl(id),
    ...overrides,
  };
}

export function record(id, overrides = {}) {
  return {
    id,
    created_at: date(id),
    updated_at: date(id),
    sha: id.toString(16).padStart(40, '0'),
    environment: 'github-pages',
    ref: 'main',
    task: 'deploy',
    transient_environment: false,
    production_environment: false,
    creator: PRINCIPAL,
    performed_via_github_app: { id: 15368, slug: 'github-actions' },
    statuses: [status(id)],
    ...overrides,
  };
}

export const records = (count) => Array.from({ length: count }, (_, index) => record(index + 1));

export const publication = (id, overrides = {}) => ({
  id: 1000 + id,
  repository: { full_name: REPOSITORY },
  head_repository: { full_name: REPOSITORY },
  name: 'CI / CD',
  path: '.github/workflows/ci.yml',
  event: 'push',
  head_branch: 'main',
  head_sha: record(id).sha,
  status: 'completed',
  conclusion: 'success',
  actor: PRINCIPAL,
  triggering_actor: PRINCIPAL,
  ...overrides,
});

export const job = (jobId) => ({
  id: jobId,
  run_id: jobId - 1000,
  head_sha: record(jobId - 2000).sha,
  name: '🚀 Deploy to GitHub Pages',
  status: 'completed',
  conclusion: 'success',
  steps: [{ name: 'Deploy to GitHub Pages', conclusion: 'success' }],
});

export const apiError = (code, retryAfter) =>
  Object.assign(new Error('PRIVATE provider detail'), {
    status: code,
    response: { headers: { 'retry-after': retryAfter } },
  });

const page = (items, parameters) => items.slice((parameters.page - 1) * 100, parameters.page * 100);
const withoutStatuses = ({ statuses: _statuses, ...item }) => item;

function routeTable(state, next) {
  const find = (id) =>
    state.find((item) => item.id === Number(id)) ?? Promise.reject(apiError(404));
  return [
    [`GET ${ROOT}`, () => ({ id: REPO_ID, full_name: REPOSITORY })],
    [`GET ${ROOT}/pages`, () => ({ build_type: 'workflow', html_url: SITE })],
    [`GET ${ROOT}/branches/main`, () => ({ commit: { sha: authority.sha } })],
    [
      `GET ${ROOT}/deployments?environment=github-pages`,
      (_m, p) => page(state, p).map(withoutStatuses),
    ],
    [
      /^GET .*\/deployments\/(\d+)\/statuses$/,
      async (m, p) => page((await find(m[1])).statuses, p),
    ],
    [
      /^POST .*\/deployments\/(\d+)\/statuses$/,
      async (m, p) => {
        assert.equal(p.auto_inactive, false);
        const item = await find(m[1]);
        const created = { ...p, id: next(), created_at: date(next()), creator: WORKFLOW_BOT };
        item.statuses.push(created);
        item.updated_at = created.created_at;
        return created;
      },
    ],
    [
      /^DELETE .*\/deployments\/(\d+)$/,
      async (m) => {
        const item = await find(m[1]);
        const latest = [...item.statuses].sort((a, b) => b.id - a.id)[0];
        assert.equal(latest.state, 'inactive');
        state.splice(state.indexOf(item), 1);
      },
    ],
    [/^GET .*\/actions\/runs\/(\d+)$/, (m) => publication(Number(m[1]) - 1000)],
    [/^GET .*\/actions\/jobs\/(\d+)$/, (m) => job(Number(m[1]))],
  ];
}

// Like the real API, every fixture response reports the live allowance unless a test overrides it; `headers` may be a function of the call count.
const withAllowance = (headers, count) => ({
  'x-ratelimit-remaining': '5000',
  ...(typeof headers === 'function' ? headers(count) : headers),
});

export function client(initial, intercept = () => undefined, headers = {}) {
  const state = structuredClone(initial);
  const calls = [];
  let counter = 10000;
  const table = routeTable(state, () => counter++);
  return {
    state,
    calls,
    request: async (route, parameters = {}) => {
      calls.push({ route, parameters });
      const override = await intercept(route, parameters, state, calls);
      if (override) return override;
      const hit = table.find(([pattern]) =>
        typeof pattern === 'string' ? pattern === route : pattern.test(route),
      );
      if (!hit) throw new Error(`Unexpected fixture route ${route}`);
      const match = typeof hit[0] === 'string' ? null : hit[0].exec(route);
      return {
        data: structuredClone(await hit[1](match, parameters)),
        headers: withAllowance(headers, calls.length),
      };
    },
  };
}

export const writes = (github) => github.calls.filter((call) => !call.route.startsWith('GET '));
export const reads = (github, pattern) =>
  github.calls.filter((call) => call.route.startsWith('GET ') && pattern.test(call.route));

export const execute = (github, options = {}) =>
  reconcilePages({ github, authority, holds, pause: async () => {}, ...options });

export const executeDestructive = (github, options = {}) =>
  execute(github, { destructive: true, ...options });

export const linkHeader = (path, pageNumber, query = 'environment=github-pages') => ({
  link: `<https://api.github.com${path}?${query}&per_page=100&page=${pageNumber}>; rel="next"`,
});
