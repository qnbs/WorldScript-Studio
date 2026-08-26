import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseDocument } from 'yaml';

function resolveProjectRoot() {
  try {
    return resolve(fileURLToPath(new URL('..', import.meta.url)));
  } catch {
    return process.cwd();
  }
}
const projectRoot = resolveProjectRoot();

// QNBS-v3: exempts only these exact job/write-key pairs from the no-unallowlisted-write policy.
const WRITE_SCOPE_ALLOWLIST = {
  'ci.yml': {
    build: new Set(['attestations', 'id-token']),
    deploy: new Set(['pages', 'id-token']),
  },
  'docker.yml': { 'build-push': new Set(['packages']) },
  'prune-deployments.yml': { prune: new Set(['deployments']) },
  'tauri-build.yml': { release: new Set(['contents']) },
  'codeql.yml': { analyze: new Set(['security-events']) },
  'scorecard.yml': { analysis: new Set(['security-events', 'id-token']) },
};

// QNBS-v3: contents:write is release/publish authority; only these jobs may hold it.
const PUBLISHING_ALLOWLIST = { 'tauri-build.yml': new Set(['release']) };

export function listWorkflowFiles(root = projectRoot, dependencies = {}) {
  const dir = join(root, '.github/workflows');
  const listDir = dependencies.readdirSync ?? readdirSync;
  if (!existsSync(dir)) return [];
  return listDir(dir)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .sort()
    .map((name) => join(dir, name));
}

export function parseWorkflowFile(filePath, dependencies = {}) {
  const readFile = dependencies.readFileSync ?? readFileSync;
  const content = readFile(filePath, 'utf8');
  const doc = parseDocument(content, { uniqueKeys: true });
  return { filePath, content, doc };
}

function jobMap(doc) {
  const jobs = doc.get('jobs', true);
  if (!jobs || typeof jobs.items === 'undefined') return new Map();
  const map = new Map();
  for (const pair of jobs.items) map.set(String(pair.key), pair.value);
  return map;
}

function permissionEntries(node) {
  // QNBS-v3: "read-all" (OSSF Scorecard's own convention) is a valid zero-write scalar form.
  if (!node) return null;
  if (typeof node.toJSON === 'function' && typeof node.items === 'undefined') {
    return { scalar: node.toJSON() };
  }
  const map = {};
  for (const pair of node.items ?? []) map[String(pair.key)] = String(pair.value);
  return { map };
}

export function checkTopLevelPermissions(fileName, doc, failures) {
  const permissions = permissionEntries(doc.get('permissions', true));
  if (!permissions) {
    failures.push({ file: fileName, message: 'missing top-level `permissions:` block' });
    return;
  }
  if (permissions.scalar !== undefined) {
    if (permissions.scalar !== 'read-all') {
      failures.push({
        file: fileName,
        message: `top-level permissions scalar must be "read-all", found "${permissions.scalar}"`,
      });
    }
    return;
  }
  const keys = Object.keys(permissions.map);
  if (keys.length !== 1 || permissions.map.contents !== 'read') {
    failures.push({
      file: fileName,
      message: 'top-level permissions must be exactly {contents: read} or the scalar "read-all"',
    });
  }
}

export function checkJobWriteScopeAllowlist(fileName, doc, failures) {
  const allowlist = WRITE_SCOPE_ALLOWLIST[fileName] ?? {};
  for (const [jobName, jobNode] of jobMap(doc)) {
    const permissions = permissionEntries(jobNode?.get?.('permissions', true));
    if (!permissions?.map) continue;
    const allowedWrites = allowlist[jobName] ?? new Set();
    for (const [key, value] of Object.entries(permissions.map)) {
      if (value === 'write' && !allowedWrites.has(key)) {
        failures.push({
          file: fileName,
          message: `job "${jobName}" declares unallowlisted write permission "${key}"`,
        });
      }
    }
  }
}

export function checkNeedsGraph(fileName, doc, failures) {
  const jobs = jobMap(doc);
  const jobNames = new Set(jobs.keys());
  const needsOf = new Map();
  for (const [jobName, jobNode] of jobs) {
    const needsNode = jobNode?.get?.('needs', true);
    const needs = !needsNode
      ? []
      : Array.isArray(needsNode.toJSON())
        ? needsNode.toJSON()
        : [needsNode.toJSON()];
    for (const dependency of needs) {
      if (!jobNames.has(dependency)) {
        failures.push({
          file: fileName,
          message: `job "${jobName}" needs unknown job "${dependency}"`,
        });
      }
    }
    needsOf.set(jobName, needs.filter((dependency) => jobNames.has(dependency)));
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (jobName, path) => {
    if (visited.has(jobName)) return;
    if (visiting.has(jobName)) {
      failures.push({
        file: fileName,
        message: `needs graph cycle detected: ${[...path, jobName].join(' -> ')}`,
      });
      return;
    }
    visiting.add(jobName);
    for (const dependency of needsOf.get(jobName) ?? []) visit(dependency, [...path, jobName]);
    visiting.delete(jobName);
    visited.add(jobName);
  };
  for (const jobName of jobNames) visit(jobName, []);
}

// QNBS-v3: dtolnay/rust-toolchain pins "# stable", not vX.Y.Z — require any comment, not that shape.
export function checkActionPins(fileName, content, failures) {
  const lines = content.split('\n');
  for (const [index, line] of lines.entries()) {
    const match = line.match(/^\s*-?\s*uses:\s*(\S+)(.*)$/);
    if (!match) continue;
    const [, ref, rest] = match;
    if (ref.startsWith('./') || ref.startsWith('docker://')) continue; // local/docker action
    const atIndex = ref.indexOf('@');
    if (atIndex === -1) {
      failures.push({
        file: fileName,
        message: `line ${index + 1}: action reference "${ref}" is missing an @ pin`,
      });
      continue;
    }
    const pin = ref.slice(atIndex + 1);
    if (!/^[0-9a-f]{40}$/.test(pin)) {
      failures.push({
        file: fileName,
        message: `line ${index + 1}: action reference "${ref}" must pin a 40-hex-char SHA`,
      });
      continue;
    }
    if (!/#\s*\S+/.test(rest)) {
      failures.push({
        file: fileName,
        message: `line ${index + 1}: SHA-pinned action "${ref}" is missing a trailing # comment`,
      });
    }
  }
}

export function checkAggregatorNeeds(fileName, doc, failures) {
  const jobs = jobMap(doc);
  if (!jobs.has('ci-success')) return;
  const aggregatorNode = jobs.get('ci-success');
  const needsNode = aggregatorNode?.get?.('needs', true);
  const declaredNeeds = new Set(needsNode ? needsNode.toJSON() : []);
  const expectedNeeds = new Set();
  for (const [jobName, jobNode] of jobs) {
    if (jobName === 'ci-success') continue;
    const continueOnError = jobNode?.get?.('continue-on-error', true);
    if (continueOnError?.toJSON?.() === true) continue; // advisory job, not gating
    const jobNeedsNode = jobNode?.get?.('needs', true);
    const jobNeeds = jobNeedsNode ? jobNeedsNode.toJSON() : [];
    const dependsOnAggregator = Array.isArray(jobNeeds)
      ? jobNeeds.includes('ci-success')
      : jobNeeds === 'ci-success';
    if (dependsOnAggregator) continue; // downstream of the aggregator, e.g. deploy
    expectedNeeds.add(jobName);
  }
  const missing = [...expectedNeeds].filter((name) => !declaredNeeds.has(name));
  const extra = [...declaredNeeds].filter((name) => !expectedNeeds.has(name));
  for (const name of missing) {
    failures.push({ file: fileName, message: `ci-success.needs is missing gating job "${name}"` });
  }
  for (const name of extra) {
    failures.push({
      file: fileName,
      message: `ci-success.needs lists "${name}", which is not a gating job (advisory or self-referential)`,
    });
  }
}

export function checkPublishingBoundary(fileName, doc, failures) {
  const allowlist = PUBLISHING_ALLOWLIST[fileName] ?? new Set();
  for (const [jobName, jobNode] of jobMap(doc)) {
    const permissions = permissionEntries(jobNode?.get?.('permissions', true));
    const hasContentsWrite = permissions?.map?.contents === 'write';
    if (hasContentsWrite && !allowlist.has(jobName)) {
      failures.push({
        file: fileName,
        message: `job "${jobName}" declares contents:write but is not on the publishing allowlist`,
      });
    }
  }
}

export function getTriggers(doc) {
  const on = doc.get('on', true) ?? doc.get(true, true);
  const triggers = { workflowDispatch: false, tagPush: false };
  if (!on) return triggers;
  const onValue = on.toJSON ? on.toJSON() : on;
  if (Array.isArray(onValue)) {
    triggers.workflowDispatch = onValue.includes('workflow_dispatch');
    return triggers;
  }
  if (onValue && typeof onValue === 'object') {
    triggers.workflowDispatch = 'workflow_dispatch' in onValue;
    const push = onValue.push;
    if (push && typeof push === 'object' && Array.isArray(push.tags) && push.tags.length > 0) {
      triggers.tagPush = true;
    }
  }
  return triggers;
}

export function checkWorkflowFile(filePath, dependencies = {}) {
  const fileName = filePath.split('/').pop();
  const failures = [];
  const { content, doc } = parseWorkflowFile(filePath, dependencies);
  if (doc.errors.length > 0) {
    for (const error of doc.errors) {
      failures.push({ file: fileName, message: `YAML parse error: ${error.message}` });
    }
    return failures; // QNBS-v3: structural checks below assume a parseable document.
  }
  checkTopLevelPermissions(fileName, doc, failures);
  checkJobWriteScopeAllowlist(fileName, doc, failures);
  checkNeedsGraph(fileName, doc, failures);
  checkActionPins(fileName, content, failures);
  checkAggregatorNeeds(fileName, doc, failures);
  checkPublishingBoundary(fileName, doc, failures);
  return failures;
}

export function checkAllWorkflows(root = projectRoot, dependencies = {}) {
  const files = dependencies.listWorkflowFiles?.(root) ?? listWorkflowFiles(root, dependencies);
  return files.flatMap((filePath) => checkWorkflowFile(filePath, dependencies));
}

export function main() {
  const failures = checkAllWorkflows();
  if (failures.length > 0) {
    console.error('Workflow-policy check failed:');
    for (const failure of failures) console.error(`- [${failure.file}] ${failure.message}`);
    process.exitCode = 1;
  } else {
    console.log(
      'Workflow-policy check passed: permissions, needs graph, action pins, aggregator sync, and publishing boundary are all structurally sound.',
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
