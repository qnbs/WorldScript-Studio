import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LineCounter, isAlias, parseDocument } from 'yaml';

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

// QNBS-v3: composite actions carry the same uses:-pin risk but have no jobs/permissions to check.
export function listActionFiles(root = projectRoot, dependencies = {}) {
  const dir = join(root, '.github/actions');
  const listDir = dependencies.readdirSync ?? readdirSync;
  if (!existsSync(dir)) return [];
  const results = [];
  // QNBS-v3: recurse any depth — a composite action can nest below its group directory.
  const walk = (currentDir) => {
    for (const entry of listDir(currentDir, { withFileTypes: true })) {
      const entryPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
      } else if (entry.name === 'action.yml' || entry.name === 'action.yaml') {
        results.push(entryPath);
      }
    }
  };
  walk(dir);
  return results.sort();
}

export function parseWorkflowFile(filePath, dependencies = {}) {
  const readFile = dependencies.readFileSync ?? readFileSync;
  const content = readFile(filePath, 'utf8');
  const lineCounter = new LineCounter();
  const doc = parseDocument(content, { uniqueKeys: true, lineCounter });
  return { filePath, content, doc, lineCounter };
}

function jobMap(doc) {
  const jobs = doc.get('jobs', true);
  if (!jobs || typeof jobs.items === 'undefined') return new Map();
  const map = new Map();
  for (const pair of jobs.items) map.set(String(pair.key), pair.value);
  return map;
}

// QNBS-v3: single alias-resolution point — every value read from a parsed tree must pass through here.
function resolveNode(node, doc) {
  return node && isAlias(node) ? node.resolve(doc) : node;
}

// QNBS-v3: an aliased *perms block resolves to Alias, not YAMLMap — must dereference before use.
function permissionEntries(node, doc) {
  const resolved = resolveNode(node, doc);
  if (!resolved) return null;
  if (typeof resolved.toJSON === 'function' && typeof resolved.items === 'undefined') {
    return { scalar: resolved.toJSON() };
  }
  const map = {};
  // QNBS-v3: a per-key value can itself be an alias (e.g. contents: *grant) — resolve each one too.
  for (const pair of resolved.items ?? []) {
    const value = resolveNode(pair.value, doc);
    map[String(pair.key)] = value !== undefined ? String(value) : String(pair.value);
  }
  return { map };
}

export function checkTopLevelPermissions(fileName, doc, failures) {
  const permissions = permissionEntries(doc.get('permissions', true), doc);
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
    const permissions = permissionEntries(jobNode?.get?.('permissions', true), doc);
    if (!permissions) continue;
    // QNBS-v3: scalar write-all grants every scope at once, which no job's allowlist ever lists.
    if (permissions.scalar !== undefined) {
      if (permissions.scalar !== 'read-all') {
        failures.push({
          file: fileName,
          message: `job "${jobName}" declares scalar permissions "${permissions.scalar}", which is never allowlisted (only "read-all" is a valid job-level scalar)`,
        });
      }
      continue;
    }
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

function collectWorkflowSteps(doc) {
  const steps = [];
  for (const [, jobNode] of jobMap(doc)) {
    const stepsNode = jobNode?.get?.('steps', true);
    if (stepsNode?.items) steps.push(...stepsNode.items);
  }
  return steps;
}

function collectActionSteps(doc) {
  const runsNode = doc.get('runs', true);
  const stepsNode = runsNode?.get?.('steps', true);
  return stepsNode?.items ?? [];
}

const DOCKER_DIGEST_PATTERN = /@sha256:[0-9a-f]{64}$/;

// QNBS-v3: checks one uses: value, resolving aliases first so *ref hides no bypass step 6/2 found.
function checkUsesRef({ usesNode, containerNode, doc, fileName, lineCounter, failures }) {
  const resolvedNode = resolveNode(usesNode, doc);
  if (!resolvedNode || typeof resolvedNode.value !== 'string') return;
  const ref = resolvedNode.value;
  if (ref.startsWith('./')) return; // local action/reusable workflow, no @ pin possible
  const line =
    lineCounter && Array.isArray(usesNode.range)
      ? lineCounter.linePos(usesNode.range[0]).line
      : undefined;
  const loc = line ? `line ${line}: ` : '';
  if (ref.startsWith('docker://')) {
    // QNBS-v3: a mutable docker tag is as unpinned as a floating action tag — require a digest.
    if (!DOCKER_DIGEST_PATTERN.test(ref)) {
      failures.push({
        file: fileName,
        message: `${loc}docker reference "${ref}" must pin an immutable @sha256 digest, not a mutable tag`,
      });
    }
    return;
  }
  const atIndex = ref.indexOf('@');
  if (atIndex === -1) {
    failures.push({ file: fileName, message: `${loc}action reference "${ref}" is missing an @ pin` });
    return;
  }
  const pin = ref.slice(atIndex + 1);
  if (!/^[0-9a-f]{40}$/.test(pin)) {
    failures.push({
      file: fileName,
      message: `${loc}action reference "${ref}" must pin a 40-hex-char SHA`,
    });
    return;
  }
  // QNBS-v3: an alias's comment can live at the anchor definition or the use site — accept either.
  const comment =
    usesNode.comment ?? resolvedNode.comment ?? (containerNode?.flow ? containerNode.comment : undefined);
  if (!comment || !/\S/.test(comment)) {
    failures.push({
      file: fileName,
      message: `${loc}SHA-pinned action "${ref}" is missing a trailing # comment`,
    });
  }
}

// QNBS-v3: walks the parsed tree (not raw text) so flow-mapping/alias steps can't bypass enforcement.
export function checkActionPins(fileName, doc, failures, options = {}) {
  const { fileKind = 'workflow', lineCounter } = options;
  const steps = fileKind === 'action' ? collectActionSteps(doc) : collectWorkflowSteps(doc);
  for (const step of steps) {
    const usesNode = step?.get?.('uses', true);
    if (!usesNode) continue;
    checkUsesRef({ usesNode, containerNode: step, doc, fileName, lineCounter, failures });
  }
  // QNBS-v3: a job can itself call a reusable workflow via jobs.<id>.uses — same pin risk as a step.
  if (fileKind === 'workflow') {
    for (const [, jobNode] of jobMap(doc)) {
      const usesNode = jobNode?.get?.('uses', true);
      if (!usesNode) continue;
      checkUsesRef({ usesNode, containerNode: jobNode, doc, fileName, lineCounter, failures });
    }
  }
}

function jobHasAlwaysCondition(jobNode) {
  const ifNode = jobNode?.get?.('if', true);
  return typeof ifNode?.value === 'string' && ifNode.value.includes('always()');
}

const NEEDS_RESULT_PATTERN = /needs\.([A-Za-z0-9_-]+)\.result/g;
const FAILURE_EXIT_PATTERN = /\bexit\s+(?:\$\S+|[1-9]\d*)/;

// QNBS-v3: if: always() disables GH's automatic dependency-gating, so the run script must re-check.
function collectNeedsResultReferences(jobNode) {
  const stepsNode = jobNode?.get?.('steps', true);
  const references = new Set();
  for (const step of stepsNode?.items ?? []) {
    const runNode = step?.get?.('run', true);
    if (typeof runNode?.value !== 'string') continue;
    // QNBS-v3: a bare reference (e.g. echo) can't fail the job — only count it alongside a real exit.
    if (!FAILURE_EXIT_PATTERN.test(runNode.value)) continue;
    for (const match of runNode.value.matchAll(NEEDS_RESULT_PATTERN)) references.add(match[1]);
  }
  return references;
}

export function checkAggregatorNeeds(fileName, doc, failures) {
  const jobs = jobMap(doc);
  if (!jobs.has('ci-success')) return;
  const aggregatorNode = jobs.get('ci-success');
  const needsNode = aggregatorNode?.get?.('needs', true);
  const needsValue = needsNode ? needsNode.toJSON() : [];
  // QNBS-v3: needs: quality (bare string) must not decompose into per-character Set entries.
  const declaredNeeds = new Set(Array.isArray(needsValue) ? needsValue : [needsValue]);
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
  if (jobHasAlwaysCondition(aggregatorNode)) {
    const checkedResults = collectNeedsResultReferences(aggregatorNode);
    for (const name of expectedNeeds) {
      if (declaredNeeds.has(name) && !checkedResults.has(name)) {
        failures.push({
          file: fileName,
          message: `ci-success uses if: always() but its run steps never check needs.${name}.result — a failure of "${name}" would not fail the aggregator`,
        });
      }
    }
  }
}

export function checkPublishingBoundary(fileName, doc, failures) {
  const allowlist = PUBLISHING_ALLOWLIST[fileName] ?? new Set();
  for (const [jobName, jobNode] of jobMap(doc)) {
    const permissions = permissionEntries(jobNode?.get?.('permissions', true), doc);
    // QNBS-v3: scalar write-all implicitly grants contents:write too — must not evade this check.
    const hasContentsWrite =
      permissions?.map?.contents === 'write' ||
      (permissions?.scalar !== undefined && permissions.scalar !== 'read-all');
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
  const fileName = basename(filePath);
  const failures = [];
  const { doc, lineCounter } = parseWorkflowFile(filePath, dependencies);
  if (doc.errors.length > 0) {
    for (const error of doc.errors) {
      failures.push({ file: fileName, message: `YAML parse error: ${error.message}` });
    }
    return failures; // QNBS-v3: structural checks below assume a parseable document.
  }
  checkTopLevelPermissions(fileName, doc, failures);
  checkJobWriteScopeAllowlist(fileName, doc, failures);
  checkNeedsGraph(fileName, doc, failures);
  checkActionPins(fileName, doc, failures, { fileKind: 'workflow', lineCounter });
  checkAggregatorNeeds(fileName, doc, failures);
  checkPublishingBoundary(fileName, doc, failures);
  return failures;
}

// QNBS-v3: composite actions have no jobs/permissions — only the SHA-pin check applies to them.
export function checkActionFile(filePath, dependencies = {}) {
  const fileName = basename(filePath);
  const failures = [];
  const { doc, lineCounter } = parseWorkflowFile(filePath, dependencies);
  if (doc.errors.length > 0) {
    for (const error of doc.errors) {
      failures.push({ file: fileName, message: `YAML parse error: ${error.message}` });
    }
    return failures;
  }
  checkActionPins(fileName, doc, failures, { fileKind: 'action', lineCounter });
  return failures;
}

export function checkAllWorkflows(root = projectRoot, dependencies = {}) {
  const workflowFiles = dependencies.listWorkflowFiles?.(root) ?? listWorkflowFiles(root, dependencies);
  const actionFiles = dependencies.listActionFiles?.(root) ?? listActionFiles(root, dependencies);
  return [
    ...workflowFiles.flatMap((filePath) => checkWorkflowFile(filePath, dependencies)),
    ...actionFiles.flatMap((filePath) => checkActionFile(filePath, dependencies)),
  ];
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
