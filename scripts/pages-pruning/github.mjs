import { refuse, validId } from './evidence.mjs';
import { REPOSITORY, ROOT, SITE } from './policy.mjs';

// QNBS-v3: 450 reads and writes per run stays under half of GitHub's documented 1,000 requests per hour per repository for GITHUB_TOKEN; the live rate headers can only lower the budget.
export const REQUEST_LIMIT = 450;
const API_ORIGIN = 'https://api.github.com';
const PAGE_SIZE = 100;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const BACKOFF_CAP_MS = 2000;
export const READ_ATTEMPTS = 3;
const RATE_RESERVE = 100;

// QNBS-v3: a cost is funded only when it fits both the local request counter and a live rate allowance that GitHub reported with the last response, with a reserve kept for CI; an unknown allowance funds nothing, so a response without a usable rate header can never leave a stale budget behind to pay for a write.
export function funds(ctx, cost) {
  const room = ctx.used + cost <= ctx.limit;
  const rate = ctx.remaining !== null && ctx.remaining >= RATE_RESERVE + cost;
  return room && rate;
}

// QNBS-v3: the write boundary re-proves the budget with fresh evidence and stops the run with the exact reason when it cannot be funded.
export function assertFunds(ctx, cost) {
  if (funds(ctx, cost)) return;
  if (ctx.remaining === null) refuse('rate-unknown');
  refuse(ctx.used + cost > ctx.limit ? 'request-budget' : 'rate-reserve');
}

export const defaultPause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createContext({ github, authority, pause = defaultPause, limit = REQUEST_LIMIT }) {
  return {
    github,
    authority,
    pause,
    limit,
    used: 0,
    answered: false,
    remaining: null,
    repositoryId: null,
    proven: new Map(),
    observed: { list: 1, status: 1 },
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
    attempt < READ_ATTEMPTS - 1,
    RETRYABLE.has(error.status),
    Number.isFinite(delay),
    delay >= 0,
    delay <= BACKOFF_CAP_MS,
  ].every(Boolean);
}

// QNBS-v3: a successful response replaces the allowance, so one that omits or malforms its rate header leaves it unknown instead of stale and the next read fails closed.
function replaceRate(ctx, headers) {
  ctx.remaining = null;
  noteRate(ctx, headers);
}

function noteRetried(ctx, headers) {
  const reported = Number(headers?.['x-ratelimit-remaining']);
  if (Number.isFinite(reported)) ctx.remaining = reported;
  else if (ctx.remaining !== null) ctx.remaining -= 1;
}

// QNBS-v3: every read, each retry included, passes the live allowance before it is sent; once a response has succeeded the allowance must be known, so a missing rate header stops the run instead of leaving the local counter as the only brake (failed attempts before any success are bounded by READ_ATTEMPTS), and a read never takes the allowance below the CI reserve.
function spendRead(ctx) {
  if (ctx.answered && ctx.remaining === null) refuse('rate-unknown');
  if (ctx.remaining !== null && ctx.remaining < RATE_RESERVE + 1) refuse('rate-reserve');
  spend(ctx);
}

export async function read(ctx, route, parameters = {}) {
  for (let attempt = 0; ; attempt++) {
    spendRead(ctx);
    try {
      const response = await ctx.github.request(`GET ${route}`, parameters);
      ctx.answered = true;
      replaceRate(ctx, response.headers);
      return response;
    } catch (error) {
      const delay = retryDelay(error, attempt);
      const retrying = shouldRetry(error, attempt, delay);
      // QNBS-v3: an error that ends the read replaces the allowance like a success does, so a header-less 404 that a caller turns into an unproved candidate cannot leave a stale allowance behind; a retried failure without a usable header still consumed a request, so the known allowance drops by one before the retry passes the reserve check.
      if (retrying) noteRetried(ctx, error.response?.headers);
      else replaceRate(ctx, error.response?.headers);
      if (!retrying) throw error;
      await ctx.pause(delay);
    }
  }
}

// QNBS-v3: writes are never retried; an ambiguous outcome is re-observed by a later pass instead of repeated against an assumed inventory.
export async function write(ctx, route, parameters) {
  spend(ctx);
  try {
    const response = await ctx.github.request(route, parameters);
    replaceRate(ctx, response?.headers);
    return response;
  } catch (error) {
    replaceRate(ctx, error.response?.headers);
    throw error;
  }
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

// QNBS-v3: the deepest page count seen per kind feeds the per-candidate cost ceiling, so the reservation grows with the real inventory instead of a fixed guess.
function noteDepth(ctx, kind, pages) {
  if (kind) ctx.observed[kind] = Math.max(ctx.observed[kind], pages);
}

export async function collect(ctx, route, maxPages = 20, kind = null) {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const response = await read(ctx, route, { per_page: PAGE_SIZE, page });
    if (!Array.isArray(response.data) || response.data.length > PAGE_SIZE) refuse('invalid-page');
    all.push(...response.data);
    const href = nextHref(response.headers);
    if (href === null && response.data.length < PAGE_SIZE) {
      noteDepth(ctx, kind, page);
      return all;
    }
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

export const listRecords = (ctx) =>
  collect(ctx, `${ROOT}/deployments?environment=github-pages`, 20, 'list');

export function loadStatuses(ctx, record) {
  if (!validId(record.id)) refuse('invalid-inventory');
  return collect(ctx, `${ROOT}/deployments/${record.id}/statuses`, 5, 'status');
}

export async function inventory(ctx) {
  await assertPagesSite(ctx);
  const records = await listRecords(ctx);
  for (const record of records) record.statuses = await loadStatuses(ctx, record);
  return records;
}
