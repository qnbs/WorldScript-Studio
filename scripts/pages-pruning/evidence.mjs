export const validId = (id) => Number.isSafeInteger(id) && id > 0;

export const anyOf = (...flags) => flags.some(Boolean);

export const refuse = (reason) => {
  throw Object.assign(new Error(reason), { reason });
};

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export function timestamp(value) {
  if (typeof value !== 'string' || !ISO_UTC.test(value)) return false;
  const parsed = Date.parse(value);
  const canonical = value.length === 20 ? value.replace('Z', '.000Z') : value;
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === canonical;
}

export const rank = (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id;

export const latestStatus = (record) => [...record.statuses].sort(rank)[0];

export const newestSuccess = (record) =>
  [...record.statuses].filter((status) => status.state === 'success').sort(rank)[0];

// QNBS-v3: keys use selected stable fields, never whole payloads, so a POST response and a later GET list entry for the same status compare equal.
const statusKey = (status) => [
  status.id,
  status.state,
  status.created_at,
  status.environment,
  status.environment_url,
  status.log_url,
  status.creator?.login ?? null,
  status.creator?.id ?? null,
];

const metaKey = (record) => [
  record.id,
  record.sha,
  record.ref,
  record.environment,
  record.created_at,
  record.task,
  record.transient_environment,
  record.production_environment,
  record.creator?.login ?? null,
  record.creator?.id ?? null,
  record.performed_via_github_app?.id ?? null,
];

export const fingerprint = (record) =>
  JSON.stringify([metaKey(record), [...record.statuses].sort(rank).map(statusKey)]);

export function proofKey(record) {
  const success = newestSuccess(record);
  return JSON.stringify([metaKey(record), success ? statusKey(success) : null]);
}

export const listKey = (item) => JSON.stringify([metaKey(item), item.updated_at ?? null]);
