#!/usr/bin/env node
/**
 * Offline validation for durable reviewer configuration.
 *
 * Vendor schemas remain vendor-owned. This checker validates repository relationships and
 * non-negotiable governance invariants without network access or credentials.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const defaultRoot = fileURLToPath(new URL('..', import.meta.url));
const root = process.env.REVIEWER_CONFIG_ROOT || defaultRoot;
const dependencyRoot = process.env.REVIEWER_DEPENDENCY_ROOT || defaultRoot;
const require = createRequire(join(dependencyRoot, 'package.json'));
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
const regexMetaCharacters = new Set(['\\', '.', '+', '^', '$', '{', '}', '(', ')', '|', '[', ']']);
const requiredPathInstructions = [
  'tests/**',
  'services/storage/**',
  'services/project*',
  'features/project/**',
  '.github/**',
  'scripts/**',
  'config/**',
  'services/network/**',
  'src-tauri/**',
  'crates/**',
  'docs/audit/**',
  'docs/history/**',
];
// QNBS-v3: live quota, billing, and current-provider state must never become durable registry data.
const forbiddenDynamicKeyPatterns = [
  /quota/,
  /ratelimit/,
  /availability/,
  /latest(?:sha|commit)/,
  /billing/,
  /current(?:provider)?(?:state|status|green|sha|commit)/,
  /lastreviewedsha/,
  /headsha/,
];

const errors = [];

function fail(message) {
  errors.push(message);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isForbiddenDynamicKey(key) {
  const normalized = key.replaceAll('_', '').replaceAll('-', '').toLowerCase();
  return forbiddenDynamicKeyPatterns.some((pattern) => pattern.test(normalized));
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(join(root, path), 'utf8'));
  } catch (error) {
    fail(`${path}: invalid JSON (${error.message})`);
    return undefined;
  }
}

export function isRegularReviewerConfigFile(path) {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

function visitKeys(value, location = '$') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (isForbiddenDynamicKey(key))
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
  validateReviewerId(reviewer.id, prefix, ids);
  return true;
}

function validateReviewerId(id, prefix, ids) {
  const normalizedId = normalizeReviewerId(id);
  if (normalizedId === undefined || normalizedId.length === 0) {
    fail(prefix + '.id must be a non-empty, trimmed string');
    return;
  }
  if (id !== normalizedId) {
    fail(prefix + '.id must not contain surrounding whitespace');
  }
  if (ids.has(normalizedId)) {
    fail(prefix + '.id must be unique');
    return;
  }
  ids.add(normalizedId);
}

export function normalizeReviewerId(id) {
  return typeof id === 'string' ? id.trim() : undefined;
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
  const absolutePath = join(root, path);
  if (!existsSync(absolutePath)) fail(prefix + '.repoConfig does not exist: ' + path);
  else if (!isRegularReviewerConfigFile(absolutePath))
    fail(prefix + '.repoConfig must be a regular file: ' + path);
}

function validateReviewerOwnership(reviewer, prefix) {
  if (!hasValidReviewerRole(reviewer.role)) fail(prefix + '.role must be a non-empty string');
  if (!['repository', 'dashboard', 'live-service'].includes(reviewer.configurationOwner))
    fail(prefix + '.configurationOwner is invalid');
}

export function hasValidReviewerRole(role) {
  return typeof role === 'string' && role.trim().length > 0;
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
    const absolutePath = join(root, path);
    if (existsSync(absolutePath) && !isRegularReviewerConfigFile(absolutePath))
      fail(path + ': configured reviewer config must be a regular file');
    if (isRegularReviewerConfigFile(absolutePath) && !configs.has(path))
      fail(path + ': configured reviewer config is missing from the registry');
  }
}

function validateRegistry(registry) {
  if (!validateRegistryEnvelope(registry)) return;
  const configs = new Set();
  const ids = new Set();
  for (const [index, reviewer] of registry.reviewers.entries())
    validateReviewer(reviewer, index, ids, configs);
  validateCanonicalReviewer(registry.reviewers);
  validateRegisteredConfigCoverage(configs);
}

function validateCanonicalReviewer(reviewers) {
  const codeRabbit = reviewers.find((reviewer) => reviewer?.id === 'coderabbit');
  if (codeRabbit?.repoConfig !== '.coderabbit.yaml')
    fail(registryPath + ': canonical coderabbit reviewer entry is required');
}

function validateCodeRabbitProfile(reviews) {
  if (reviews?.profile !== 'chill') fail('.coderabbit.yaml: reviews.profile must be chill');
}

function validateCodeRabbitMutationPolicy(reviews) {
  if (reviews?.request_changes_workflow !== false)
    fail('.coderabbit.yaml: reviews.request_changes_workflow must be false');
  if (reviews?.auto_apply_labels !== false || reviews?.auto_assign_reviewers !== false)
    fail('.coderabbit.yaml: automatic label/reviewer mutation must remain disabled');
}

function validateCodeRabbitReviewPolicy(reviews) {
  validateCodeRabbitProfile(reviews);
  validateCodeRabbitMutationPolicy(reviews);
}

function validateCodeRabbitAutoReview(reviews) {
  if (!hasEnabledAutoReview(reviews))
    fail('.coderabbit.yaml: automatic incremental review must be explicit and enabled');
}

export function hasEnabledAutoReview(reviews) {
  const autoReview = reviews?.auto_review;
  return autoReview?.enabled === true && autoReview.auto_incremental_review === true;
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

function validateCodeRabbitPathFilters(pathFilters) {
  if (!Array.isArray(pathFilters) || pathFilters.length === 0)
    fail('.coderabbit.yaml: path_filters must be a non-empty array');
  if (Array.isArray(pathFilters) && pathFilters.includes('!**'))
    fail('.coderabbit.yaml: path_filters must not exclude the entire repository');
}

export function hasValidPathInstructionShape(instruction) {
  return (
    isRecord(instruction) &&
    typeof instruction.path === 'string' &&
    instruction.path.trim().length > 0
  );
}

function validatePathInstruction(instruction, index, instructionPaths) {
  const prefix = `.coderabbit.yaml: path_instructions[${index}]`;
  if (!hasValidPathInstructionShape(instruction)) {
    fail(prefix + ' must be a mapping with a non-empty string path');
    return;
  }
  instructionPaths.add(instruction.path);
  if (typeof instruction.instructions !== 'string' || instruction.instructions.trim().length === 0)
    fail(prefix + ' must contain non-empty instructions');
}

function collectPathInstructionPaths(pathInstructions) {
  const instructionPaths = new Set();
  for (const [index, instruction] of pathInstructions.entries())
    validatePathInstruction(instruction, index, instructionPaths);
  return instructionPaths;
}

function validateRequiredPathInstructions(instructionPaths) {
  for (const path of requiredPathInstructions) {
    if (!instructionPaths.has(path))
      fail('.coderabbit.yaml: required path instruction is missing: ' + path);
  }
}

function validateCodeRabbitPathInstructions(pathInstructions) {
  if (!Array.isArray(pathInstructions) || pathInstructions.length === 0) {
    fail('.coderabbit.yaml: path_instructions must be a non-empty array');
    return;
  }
  const instructionPaths = collectPathInstructionPaths(pathInstructions);
  validateRequiredPathInstructions(instructionPaths);
  validatePathInstructionTargets(pathInstructions);
}

function validateCodeRabbitPathPolicy(reviews) {
  validateCodeRabbitPathFilters(reviews?.path_filters);
  validateCodeRabbitPathInstructions(reviews?.path_instructions);
}

function listTrackedRepositoryFiles() {
  try {
    return execFileSync('git', ['-C', root, 'ls-files', '--cached', '--full-name', '-z'], {
      encoding: 'utf8',
    })
      .split('\0')
      .filter(Boolean);
  } catch (error) {
    fail(`git ls-files failed while enumerating reviewer paths: ${error.message}`);
    return [];
  }
}

function listArchiveRepositoryFiles(directory = root) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listArchiveRepositoryFiles(absolutePath));
    else if (entry.isFile()) files.push(relative(root, absolutePath).replaceAll('\\', '/'));
  }
  return files;
}

function listRepositoryFiles() {
  return existsSync(join(root, '.git'))
    ? listTrackedRepositoryFiles()
    : listArchiveRepositoryFiles();
}

function globToRegExp(pattern) {
  let expression = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*' && pattern[index + 1] === '*') {
      expression += '.*';
      index += 1;
    } else if (character === '*') {
      expression += '[^/]*';
    } else if (regexMetaCharacters.has(character)) {
      expression += '\\' + character;
    } else {
      expression += character;
    }
  }
  return new RegExp('^' + expression + '$');
}

function validatePathInstructionTargets(pathInstructions) {
  const repositoryFiles = listRepositoryFiles();
  for (const instruction of pathInstructions) {
    if (!hasValidPathInstructionShape(instruction)) {
      fail('.coderabbit.yaml: malformed path instruction cannot pass target validation');
      continue;
    }
    if (!repositoryFiles.some((file) => globToRegExp(instruction.path).test(file)))
      fail('.coderabbit.yaml: path instruction matches no repository files: ' + instruction.path);
  }
}

function validateCodeRabbitPostMergeActions(reviews) {
  const actions = reviews?.post_merge_actions;
  if (actions === undefined) return;
  if (!Array.isArray(actions) || actions.length > 0)
    fail('.coderabbit.yaml: post_merge_actions must remain empty');
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
  validateCodeRabbitPostMergeActions(reviews);
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
