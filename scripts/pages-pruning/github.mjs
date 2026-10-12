import { refuse, validId } from './evidence.mjs';
import { REPOSITORY, ROOT, SITE } from './policy.mjs';

// QNBS-v3: 450 reads and writes per run stays under half of GitHub's documented 1,000 requests per hour per repository for GITHUB_TOKEN; the live rate headers can only lower the budget.
export const REQUEST_LIMIT = 450;
const API_ORIGIN = 'https://api.github.com';
const PAGE_SIZE = 100;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const BACKOFF_CAP_MS = 2000;

export const defaultPause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createContext({ github, authority, pause = defaultPause, limit = REQUEST_LIMIT }) {
  return {
    github,
    authority,
    pause,
    limit,
    used: 0,
    remaining: null,
    repositoryId: null,
    proven: new Map(),
  };
}

function spend(ctx) {
  if (ctx.used >= ctx.limit) refuse('request-budget');
  ctx.used += 1;
}

function noteRate(ctx, headers) {
  const remaining = Number(headers?.['x-ratelimit-remaining']);
  if (Number.isFinite(remaining)) ctx.remaining = remaining;
}

const retryDelay = (error, attempt) =>
  error.status === 429
    ? Number(error.response?.headers?.['retry-after']) * 1000
    : 250 * 2 ** attempt;

function shouldRetry(error, attempt, delay) {
  return [
    attempt < 2,
    RETRYABLE.has(error.status),
    Number.isFinite(delay),
    delay >= 0,
    delay <= BACKOFF_CAP_MS,
  ].every(Boolean);
}

export async function read(ctx, route, parameters = {}) {
  for (let attempt = 0; ; attempt++) {
    spend(ctx);
    try {
      const response = await ctx.github.request(`GET ${route}`, parameters);
      noteRate(ctx, response.headers);
      return response;
    } catch (error) {
      const delay = retryDelay(error, attempt);
      if (!shouldRetry(error, attempt, delay)) throw error;
      await ctx.pause(delay);
    }
  }
}

// QNBS-v3: writes are never retried; an ambiguous outcome is re-observed by a later pass instead of repeated against an assumed inventory.
export async function write(ctx, route, parameters) {
  spend(ctx);
  const response = await ctx.github.request(route, parameters);
  noteRate(ctx, response?.headers);
  return response;
}

async function repositoryId(ctx) {
  if (ctx.repositoryId === null) {
    const { data } = await read(ctx, ROOT);
    if (!validId(data.id) || data.full_name !== REPOSITORY) refuse('unknown-repository');
    ctx.repositoryId = data.id;
  }
  return ctx.repositoryId;
}

const queryKey = (params) =>
  [...params]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('&');

function parseNext(href) {
  try {
    return new URL(href);
  } catch {
    return refuse('invalid-pagination-link');
  }
}

// QNBS-v3: GitHub emits next links under /repositories/{id}; accept that form only for the verified repository id, with the original query and the exact next page.
async function assertCanonicalNext(ctx, href, route, page) {
  const url = parseNext(href);
  const [path, query = ''] = route.split('?');
  const expected = new URLSearchParams(query);
  expected.set('page', String(page + 1));
  expected.set('per_page', String(PAGE_SIZE));
  if (url.origin !== API_ORIGIN || queryKey(url.searchParams) !== queryKey(expected))
    refuse('invalid-pagination-link');
  if (url.pathname === path) return;
  const byId = path.replace(`/repos/${REPOSITORY}`, `/repositories/${await repositoryId(ctx)}`);
  if (url.pathname !== byId) refuse('invalid-pagination-link');
}

const nextHref = (headers) => /<([^>]+)>;\s*rel="next"/.exec(headers?.link ?? '')?.[1] ?? null;

export async function collect(ctx, route, maxPages = 20) {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const response = await read(ctx, route, { per_page: PAGE_SIZE, page });
    if (!Array.isArray(response.data) || response.data.length > PAGE_SIZE) refuse('invalid-page');
    all.push(...response.data);
    const href = nextHref(response.headers);
    if (href === null && response.data.length < PAGE_SIZE) return all;
    if (href === null) continue;
    if (response.data.length === 0) refuse('invalid-pagination-link');
    await assertCanonicalNext(ctx, href, route, page);
  }
  return refuse('pagination-limit');
}

export async function assertPagesSite(ctx) {
  const { data } = await read(ctx, `${ROOT}/pages`);
  if (data.build_type !== 'workflow' || data.html_url !== SITE) refuse('unknown-pages-site');
}

export const listRecords = (ctx) => collect(ctx, `${ROOT}/deployments?environment=github-pages`);

export function loadStatuses(ctx, record) {
  if (!validId(record.id)) refuse('invalid-inventory');
  return collect(ctx, `${ROOT}/deployments/${record.id}/statuses`, 5);
}

export async function inventory(ctx) {
  await assertPagesSite(ctx);
  const records = await listRecords(ctx);
  for (const record of records) record.statuses = await loadStatuses(ctx, record);
  return records;
}
