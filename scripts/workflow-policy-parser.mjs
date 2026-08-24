import { parseDocument } from 'yaml';

export class WorkflowParseError extends Error {
  constructor(label, errors) {
    super(`${label}: invalid YAML (${errors.map((error) => error.message).join('; ')})`);
    this.name = 'WorkflowParseError';
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseWorkflow(source, label) {
  const document = parseDocument(source, {
    prettyErrors: false,
    schema: 'core',
    uniqueKeys: true,
    version: '1.2',
  });
  if (document.errors.length > 0) throw new WorkflowParseError(label, document.errors);
  const workflow = document.toJS({ mapAsMap: false });
  if (!isRecord(workflow))
    throw new WorkflowParseError(label, [{ message: 'root must be a mapping' }]);
  return workflow;
}

export function asRecord(value) {
  return isRecord(value) ? value : {};
}

export function asStringList(value) {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => typeof entry === 'string');
}

export function collectValuesByKey(value, key, values = []) {
  if (Array.isArray(value)) {
    for (const entry of value) collectValuesByKey(entry, key, values);
    return values;
  }
  if (!isRecord(value)) return values;
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (entryKey === key) values.push(entryValue);
    collectValuesByKey(entryValue, key, values);
  }
  return values;
}

export function workflowJobs(workflow) {
  const jobs = asRecord(workflow.jobs);
  return Object.entries(jobs).filter(([, job]) => isRecord(job));
}

export function workflowSteps(workflow) {
  return workflowJobs(workflow).flatMap(([, job]) =>
    Array.isArray(job.steps) ? job.steps.filter((step) => isRecord(step)) : [],
  );
}
