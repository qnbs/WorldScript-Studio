import { DEPLOYMENT_ID, parseJson, refuse } from './util.mjs';

// QNBS-v3: previews kept as current review or retest evidence are named in a reviewed file on main; anything the file does not list gets no such protection, and a malformed file stops the run.
export function readHolds(deps) {
  const holds = parseJson(deps.holds(), 'holds');
  const keys = holds && typeof holds === 'object' ? Object.keys(holds).join(',') : '';
  if (keys !== 'review' || !Array.isArray(holds.review)) refuse('invalid-holds');
  if (!holds.review.every((id) => typeof id === 'string' && DEPLOYMENT_ID.test(id)))
    refuse('invalid-holds');
  return new Set(holds.review);
}
