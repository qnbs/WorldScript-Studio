import { SCOPE } from './scope.mjs';
import { ALIAS_HOST, DEPLOYMENT_ID, parseJson, refuse } from './util.mjs';

const MAX_PAGES = 10;
const READ_ATTEMPTS = 2;

const withQuery = (path, params) => `${path}?${new URLSearchParams(params)}`;

// QNBS-v3: reads get one bounded retry; the original error text is dropped because CLI failures can echo credentials, so only a fixed reason leaves this module.
export async function providerGet(deps, path) {
  for (let attempt = 1; attempt <= READ_ATTEMPTS; attempt++) {
    let text;
    try {
      text = deps.vercel(['api', path, '--method', 'GET']);
    } catch {
      if (attempt < READ_ATTEMPTS) await deps.sleep(500);
      continue;
    }
    return parseJson(text, 'provider-response');
  }
  return refuse('provider-read-failed');
}

// QNBS-v3: a page without pagination metadata is malformed, not final, so an inventory is complete only when the provider says there is no next page.
function nextPage(body, key) {
  const pagination = body?.pagination;
  const wellFormed = [
    Array.isArray(body?.[key]),
    pagination !== null,
    typeof pagination === 'object',
  ];
  if (!wellFormed.every(Boolean) || !('next' in pagination)) refuse('invalid-provider-response');
  return pagination.next ?? null;
}

// QNBS-v3: the overlap between two pages must be byte-identical; a record that differs between reads (an alias rebound, a deployment that changed state) means the inventory moved while it was read, so it is refused instead of keeping either version.
function remember(items, key, item) {
  const seen = items.get(key);
  if (seen !== undefined && JSON.stringify(seen) !== JSON.stringify(item))
    refuse('provider-inventory-inconsistent');
  items.set(key, item);
}

// QNBS-v3: the cursor is a creation timestamp, so the next request starts one millisecond above it and the overlap is removed by a unique key; records that share the boundary timestamp are then read instead of skipped, and a page that adds nothing new stops the run instead of looping.
async function paged(deps, path, key, shape) {
  const items = new Map();
  let until = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = { projectId: SCOPE.projectId, teamId: SCOPE.teamId, limit: '100' };
    if (until !== null) params.until = String(until + 1);
    const body = await providerGet(deps, withQuery(path, params));
    const next = nextPage(body, key);
    if (!body[key].every(shape.valid)) refuse('invalid-provider-response');
    const before = items.size;
    for (const item of body[key]) remember(items, shape.key(item), item);
    if (next === null) return [...items.values()];
    if (items.size === before) refuse('provider-pagination-stalled');
    until = next;
  }
  return refuse('provider-pagination-limit');
}

const hasHost = (item) => typeof item?.alias === 'string' && item.alias !== '';
const linkIsExplicit = (value) => value === null || DEPLOYMENT_ID.test(value);

// QNBS-v3: every record must carry the fields classification relies on; an alias must name its host and state its deployment link explicitly (null for a redirect), so a response that drops or renames the link refuses instead of reading as "no alias".
const DEPLOYMENT_SHAPE = {
  key: (item) => item.uid,
  valid: (item) => DEPLOYMENT_ID.test(item?.uid),
};

const ALIAS_SHAPE = {
  key: (item) => item.alias,
  valid: (item) => hasHost(item) && linkIsExplicit(item.deploymentId),
};

export const listDeployments = (deps) =>
  paged(deps, '/v6/deployments', 'deployments', DEPLOYMENT_SHAPE);
export const listAliases = (deps) => paged(deps, '/v4/aliases', 'aliases', ALIAS_SHAPE);

export async function readProject(deps) {
  const path = withQuery(`/v9/projects/${SCOPE.projectId}`, { teamId: SCOPE.teamId });
  const project = await providerGet(deps, path);
  const identity = [
    project.id === SCOPE.projectId,
    project.name === SCOPE.project,
    project.accountId === SCOPE.teamId,
  ];
  if (!identity.every(Boolean)) refuse('project-mismatch');
  const linked = [project.link?.org === SCOPE.org, project.link?.repo === SCOPE.repo];
  if (!linked.every(Boolean)) refuse('repository-unconfirmed');
  return project;
}

// QNBS-v3: both mutations validate their single argument and always pass --safe or an explicit host, so a project name or pattern can never reach the project-wide form of remove.
export function removeAlias(deps, host) {
  if (!ALIAS_HOST.test(host)) refuse('invalid-alias-host');
  deps.vercel(['alias', 'remove', host, '--yes', '--scope', SCOPE.team]);
}

export function removeDeployment(deps, id) {
  if (!DEPLOYMENT_ID.test(id)) refuse('invalid-deployment-id');
  deps.vercel(['remove', id, '--safe', '--yes', '--scope', SCOPE.team]);
}
