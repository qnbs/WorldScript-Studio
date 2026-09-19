#!/usr/bin/env node
/**
 * Offline validation for durable reviewer configuration.
 *
 * Vendor schemas remain vendor-owned. This checker validates repository relationships and
 * non-negotiable governance invariants without network access or credentials.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';

const root = fileURLToPath(new URL('..', import.meta.url));
const registryPath = join(root, 'config/reviewer-registry.json');
const knownConfigPaths = new Set([
  '.coderabbit.yaml',
  'cubic.yaml',
  '.codeant/instructions.json',
  '.codeant/review.json',
  '.codescene/code-health-rules.json',
  '.deepsource.toml',
  'codecov.yml',
  '.pr_agent.toml',
  '.gitguardian.yaml',
  '.github/workflows/ci.yml',
  '.github/workflows/codeql.yml',
]);
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

function readJson(path) {
  try {
    return JSON.parse(readFileSync(join(root, path), 'utf8'));
  } catch (error) {
    fail(`${path}: invalid JSON (${error.message})`);
    return null;
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
  if (!existsSync(join(root, path))) return null;
  const document = parseDocument(readFileSync(join(root, path), 'utf8'), { uniqueKeys: true });
  for (const error of document.errors) fail(`${path}: ${error.message}`);
  return document.errors.length ? null : document.toJS();
}

function validateRegistry(registry) {
  if (registry.schemaVersion !== 1) fail(`${registryPath}: schemaVersion must be 1`);
  if (registry.authority !== 'docs/REVIEWER-GOVERNANCE.md')
    fail(`${registryPath}: authority must point to canonical governance`);
  if (!Array.isArray(registry.reviewers) || registry.reviewers.length === 0)
    fail(`${registryPath}: reviewers must be a non-empty array`);

  const configs = new Set();
  const ids = new Set();
  for (const [index, reviewer] of (registry.reviewers ?? []).entries()) {
    const prefix = `${registryPath}: reviewers[${index}]`;
    if (!reviewer || typeof reviewer !== 'object') {
      fail(`${prefix} must be an object`);
      continue;
    }
    if (!reviewer.id || ids.has(reviewer.id)) fail(`${prefix}.id must be unique and non-empty`);
    ids.add(reviewer.id);
    if (!reviewer.role) fail(`${prefix}.role is required`);
    if (reviewer.repoConfig !== null && reviewer.repoConfig !== undefined) {
      if (typeof reviewer.repoConfig !== 'string' || reviewer.repoConfig.startsWith('/'))
        fail(`${prefix}.repoConfig must be a repository-relative path or null`);
      else {
        configs.add(reviewer.repoConfig);
        if (!knownConfigPaths.has(reviewer.repoConfig))
          fail(`${prefix}.repoConfig is not an approved reviewer config path`);
        if (!existsSync(join(root, reviewer.repoConfig)))
          fail(`${prefix}.repoConfig does not exist: ${reviewer.repoConfig}`);
      }
    }
    if (!['repository', 'dashboard', 'live-service'].includes(reviewer.configurationOwner))
      fail(`${prefix}.configurationOwner is invalid`);
    if (reviewer.mayMutateBranch !== false) fail(`${prefix}.mayMutateBranch must remain false`);
    if (typeof reviewer.blockingAuthority !== 'boolean')
      fail(`${prefix}.blockingAuthority must be boolean`);
    if (reviewer.statusSource !== 'live') fail(`${prefix}.statusSource must be live`);
    visitKeys(reviewer, prefix);
  }

  for (const path of knownConfigPaths) {
    if (existsSync(join(root, path)) && !configs.has(path))
      fail(`${path}: configured reviewer config is missing from the registry`);
  }
}

function validateCodeRabbit() {
  const codeRabbit = loadCodeRabbit();
  if (!codeRabbit) return;
  const reviews = codeRabbit.reviews;
  if (reviews?.request_changes_workflow !== false)
    fail('.coderabbit.yaml: reviews.request_changes_workflow must be false');
  if (reviews.profile !== 'chill') fail('.coderabbit.yaml: reviews.profile must be chill');
  if (reviews.auto_apply_labels !== false || reviews.auto_assign_reviewers !== false)
    fail('.coderabbit.yaml: automatic label/reviewer mutation must remain disabled');
  const autoReview = reviews.auto_review;
  if (!autoReview?.enabled || autoReview.auto_incremental_review !== true)
    fail('.coderabbit.yaml: automatic incremental review must be explicit and enabled');
  for (const [name, setting] of Object.entries(reviews.finishing_touches ?? {})) {
    if (setting?.enabled !== false)
      fail(`.coderabbit.yaml: finishing_touches.${name}.enabled must be false`);
  }
  for (const name of ['docstrings', 'title', 'description', 'issue_assessment']) {
    if (reviews.pre_merge_checks?.[name]?.mode !== 'off')
      fail(`.coderabbit.yaml: pre_merge_checks.${name}.mode must be off`);
  }
  if (!Array.isArray(reviews.path_filters) || !Array.isArray(reviews.path_instructions))
    fail('.coderabbit.yaml: path_filters and path_instructions must be arrays');
  if (reviews.post_merge_actions?.length)
    fail('.coderabbit.yaml: post_merge_actions must remain empty');
}

function validate() {
  const registry = readJson('config/reviewer-registry.json');
  if (!registry) return;
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
