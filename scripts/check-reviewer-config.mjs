#!/usr/bin/env node
/**
 * Offline validation for durable reviewer configuration.
 *
 * Vendor schemas remain vendor-owned. This checker validates repository relationships and
 * non-negotiable governance invariants without network access or credentials.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const defaultRoot = fileURLToPath(new URL('..', import.meta.url));
const root = process.env.REVIEWER_CONFIG_ROOT || defaultRoot;
const require = createRequire(join(root, 'package.json'));
const { parseDocument } = require('yaml');
const registryPath = join(root, 'config/reviewer-registry.json');
const approvedReviewerConfigPaths = new Set([
  '.coderabbit.yaml',
  'cubic.yaml',
  '.codeant/instructions.json',
  '.codeant/review.json',
  '.codescene/code-health-rules.json',
  '.deepsource.toml',
  'codecov.yml',
  'src-tauri/osv-scanner.toml',
  '.pr_agent.toml',
  '.gitguardian.yaml',
  '.github/workflows/codeql.yml',
]);
const requiredFinishingTouches = [
  'docstrings',
  'unit_tests',
  'simplify',
  'autofix',
  'fix_ci',
  'resolve_merge_conflict',
];
const requiredPreMergeChecks = ['docstrings', 'title', 'description', 'issue_assessment'];
// QNBS-v3: live quota, billing, and current-provider state must never become durable registry data.
const forbiddenDynamicKeys = new Set([
  'quota',
  'ratelimit',
  'availability',
  'latestsha',
  'billing',
  'currentstate',
  'lastreviewedsha',
  'headsha',
  'currentgreen',
]);

const errors = [];

function fail(message) {
  errors.push(message);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(join(root, path), 'utf8'));
  } catch (error) {
    fail(`${path}: invalid JSON (${error.message})`);
    return undefined;
  }
}

function visitKeys(value, location = '$') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenDynamicKeys.has(key.replaceAll('_', '').toLowerCase()))
      fail(`${location}.${key}: live provider state is not durable registry data`);
    visitKeys(child, `${location}.${key}`);
  }
}

function loadCodeRabbit() {
  const path = '.coderabbit.yaml';
  if (!existsSync(join(root, path))) return undefined;
  const document = parseDocument(readFileSync(join(root, path), 'utf8'), { uniqueKeys: true });
  for (const error of document.errors) fail(`${path}: ${error.message}`);
  if (document.errors.length) return undefined;
  const config = document.toJS();
  if (!isRecord(config)) {
    fail(path + ': root must be a mapping');
    return undefined;
  }
  return config;
}

function validateRegistryEnvelope(registry) {
  if (!isRecord(registry)) {
    fail(registryPath + ': root must be an object');
    return false;
  }
  visitKeys(registry);
  if (registry.schemaVersion !== 1) fail(registryPath + ': schemaVersion must be 1');
  if (registry.authority !== 'docs/REVIEWER-GOVERNANCE.md')
    fail(registryPath + ': authority must point to canonical governance');
  if (!Array.isArray(registry.reviewers) || registry.reviewers.length === 0) {
    fail(registryPath + ': reviewers must be a non-empty array');
    return false;
  }
  return true;
}

function validateReviewerShape(reviewer, prefix, ids) {
  if (!isRecord(reviewer)) {
    fail(prefix + ' must be an object');
    return false;
  }
  if (typeof reviewer.id !== 'string' || reviewer.id.length === 0 || ids.has(reviewer.id))
    fail(prefix + '.id must be unique and non-empty');
  else ids.add(reviewer.id);
  return true;
}

function validateReviewerConfig(reviewer, prefix, configs) {
  const path = reviewer.repoConfig;
  if (path === null || path === undefined) return;
  if (typeof path !== 'string' || path.startsWith('/')) {
    fail(prefix + '.repoConfig must be a repository-relative path or null');
    return;
  }
  configs.add(path);
  if (!approvedReviewerConfigPaths.has(path))
    fail(prefix + '.repoConfig is not an approved reviewer config path');
  if (!existsSync(join(root, path))) fail(prefix + '.repoConfig does not exist: ' + path);
}

function validateReviewerOwnership(reviewer, prefix) {
  if (!reviewer.role) fail(prefix + '.role is required');
  if (!['repository', 'dashboard', 'live-service'].includes(reviewer.configurationOwner))
    fail(prefix + '.configurationOwner is invalid');
}

function validateReviewerMutationBoundary(reviewer, prefix) {
  if (reviewer.mayMutateBranch !== false) fail(prefix + '.mayMutateBranch must remain false');
  if (typeof reviewer.blockingAuthority !== 'boolean')
    fail(prefix + '.blockingAuthority must be boolean');
  if (reviewer.statusSource !== 'live') fail(prefix + '.statusSource must be live');
}

function validateReviewer(reviewer, index, ids, configs) {
  const prefix = registryPath + ': reviewers[' + index + ']';
  if (!validateReviewerShape(reviewer, prefix, ids)) return;
  validateReviewerConfig(reviewer, prefix, configs);
  validateReviewerOwnership(reviewer, prefix);
  validateReviewerMutationBoundary(reviewer, prefix);
}

function validateRegisteredConfigCoverage(configs) {
  for (const path of approvedReviewerConfigPaths) {
    if (existsSync(join(root, path)) && !configs.has(path))
      fail(path + ': configured reviewer config is missing from the registry');
  }
}

function validateRegistry(registry) {
  if (!validateRegistryEnvelope(registry)) return;
  const configs = new Set();
  const ids = new Set();
  for (const [index, reviewer] of registry.reviewers.entries())
    validateReviewer(reviewer, index, ids, configs);
  validateRegisteredConfigCoverage(configs);
}

function validateCodeRabbitReviewPolicy(reviews) {
  if (reviews?.request_changes_workflow !== false)
    fail('.coderabbit.yaml: reviews.request_changes_workflow must be false');
  if (reviews?.profile !== 'chill') fail('.coderabbit.yaml: reviews.profile must be chill');
  if (reviews?.auto_apply_labels !== false || reviews?.auto_assign_reviewers !== false)
    fail('.coderabbit.yaml: automatic label/reviewer mutation must remain disabled');
}

function validateCodeRabbitAutoReview(reviews) {
  const autoReview = reviews?.auto_review;
  if (!autoReview?.enabled || autoReview.auto_incremental_review !== true)
    fail('.coderabbit.yaml: automatic incremental review must be explicit and enabled');
}

function validateCodeRabbitFinishingTouches(reviews) {
  const finishingTouches = reviews?.finishing_touches;
  if (!isRecord(finishingTouches)) {
    fail('.coderabbit.yaml: finishing_touches must be an explicit mapping');
    return;
  }
  for (const name of requiredFinishingTouches) {
    if (finishingTouches[name]?.enabled !== false)
      fail('.coderabbit.yaml: finishing_touches.' + name + '.enabled must be false');
  }
}

function validateCodeRabbitPreMergeChecks(reviews) {
  const preMergeChecks = reviews?.pre_merge_checks;
  for (const name of requiredPreMergeChecks) {
    if (preMergeChecks?.[name]?.mode !== 'off')
      fail('.coderabbit.yaml: pre_merge_checks.' + name + '.mode must be off');
  }
}

function validateCodeRabbitPathPolicy(reviews) {
  if (!Array.isArray(reviews?.path_filters) || reviews.path_filters.length === 0)
    fail('.coderabbit.yaml: path_filters must be a non-empty array');
  if (!Array.isArray(reviews?.path_instructions) || reviews.path_instructions.length === 0)
    fail('.coderabbit.yaml: path_instructions must be a non-empty array');
}

function validateCodeRabbit() {
  const codeRabbit = loadCodeRabbit();
  if (!codeRabbit) return;
  const reviews = codeRabbit.reviews;
  validateCodeRabbitReviewPolicy(reviews);
  validateCodeRabbitAutoReview(reviews);
  validateCodeRabbitFinishingTouches(reviews);
  validateCodeRabbitPreMergeChecks(reviews);
  validateCodeRabbitPathPolicy(reviews);
  if (reviews?.post_merge_actions?.length)
    fail('.coderabbit.yaml: post_merge_actions must remain empty');
}

function validate() {
  const registry = readJson('config/reviewer-registry.json');
  if (registry === undefined) return;
  validateRegistry(registry);
  validateCodeRabbit();
}

validate();
if (errors.length) {
  for (const error of errors) console.error(`[reviewers] FAIL — ${error}`);
  process.exitCode = 1;
} else {
  console.log('[reviewers] OK — durable configuration and no-mutation invariants hold');
}
