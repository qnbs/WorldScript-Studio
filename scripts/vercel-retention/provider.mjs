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

async function paged(deps, path, key) {
  const items = [];
  let until = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = { projectId: SCOPE.projectId, teamId: SCOPE.teamId, limit: '100' };
    if (until !== null) params.until = String(until);
    const body = await providerGet(deps, withQuery(path, params));
    items.push(...body[key]);
    until = nextPage(body, key);
    if (until === null) return items;
  }
  return refuse('provider-pagination-limit');
}

export const listDeployments = (deps) => paged(deps, '/v6/deployments', 'deployments');
export const listAliases = (deps) => paged(deps, '/v4/aliases', 'aliases');

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
