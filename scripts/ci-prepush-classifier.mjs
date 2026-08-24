const DOC_FILE = /\.(?:md|mdx)$/i;
const TS_FILE = /\.(?:c|m)?tsx?$|\.(?:c|m)?jsx?$/i;

const DOC_ROOTS = ['docs/', '.cursor/rules/'];
const WORKFLOW_ROOTS = ['.github/workflows/', '.github/actions/'];
const RUST_ROOTS = ['src-tauri/', 'crates/'];
const TOOLING_ROOTS = ['scripts/'];
const TOOLING_FILES = new Set(['.gitleaks.toml']);
const WORKFLOW_POLICY_FILES = new Set([
  'scripts/check-workflow-policy.mjs',
  'scripts/workflow-policy-guards.mjs',
  'scripts/workflow-policy-guards.d.mts',
]);
const I18N_POLICY_FILES = new Set(['scripts/check-i18n-keys.mjs', 'scripts/i18n-locales.mjs']);
const NATIVE_CONTRACT_ROOTS = [
  'packages/desktop-contracts/',
  'services/desktop/',
  'services/platform/',
];
const DEPENDENCY_FILES = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.npmrc',
  '.nvmrc',
  'rust-toolchain',
  'rust-toolchain.toml',
]);
const BUILD_CONFIG_FILES = new Set([
  'biome.json',
  'index.html',
  'playwright.config.ts',
  'postcss.config.js',
  'postcss.config.mjs',
  'tailwind.config.js',
  'tailwind.config.ts',
  'turbo.json',
  'vite.config.ts',
  'vitest.config.ts',
]);

function startsWithRoot(file, roots) {
  return roots.some((root) => file.startsWith(root));
}

export function isWorkflowPolicyFile(file) {
  return WORKFLOW_POLICY_FILES.has(file.replaceAll('\\', '/').replace(/^\.\//, ''));
}

export function isI18nPolicyFile(file) {
  return I18N_POLICY_FILES.has(file.replaceAll('\\', '/').replace(/^\.\//, ''));
}

function isInstructionFile(file) {
  return (
    file === 'AGENTS.md' ||
    file === 'CLAUDE.md' ||
    file === '.cursorrules' ||
    file === '.github/copilot-instructions.md' ||
    file.startsWith('.cursor/rules/')
  );
}

export function classifyFile(file) {
  const normalized = file.replaceAll('\\', '/').replace(/^\.\//, '');
  const base = normalized.split('/').at(-1) ?? normalized;

  if (startsWithRoot(normalized, WORKFLOW_ROOTS)) return 'WORKFLOW';
  if (
    DOC_FILE.test(normalized) ||
    startsWithRoot(normalized, DOC_ROOTS) ||
    isInstructionFile(normalized)
  ) {
    return 'DOCS';
  }
  if (
    RUST_ROOTS.some((root) => normalized.startsWith(root)) ||
    /(?:^|\/)(?:Cargo\.toml|Cargo\.lock)$/.test(normalized) ||
    normalized.endsWith('.rs')
  ) {
    return 'RUST_TAURI';
  }
  if (
    NATIVE_CONTRACT_ROOTS.some((root) => normalized.startsWith(root)) ||
    /DesktopPlatform|desktop-contract/i.test(normalized)
  ) {
    return 'DESKTOP_NATIVE_CONTRACT';
  }
  if (normalized.startsWith('tests/'))
    return TS_FILE.test(normalized) ? 'TYPESCRIPT_APPLICATION' : 'TEST_ONLY';
  if (TOOLING_FILES.has(normalized)) return 'TOOLING';
  if (startsWithRoot(normalized, TOOLING_ROOTS)) return 'TOOLING';
  if (
    DEPENDENCY_FILES.has(base) ||
    normalized.startsWith('patches/') ||
    (normalized.startsWith('packages/') && base === 'package.json')
  ) {
    return 'DEPENDENCY_TOOLCHAIN';
  }
  if (BUILD_CONFIG_FILES.has(base) || normalized.startsWith('scripts/'))
    return 'BUILD_CONFIGURATION';
  if (TS_FILE.test(normalized) && !normalized.startsWith('scripts/'))
    return 'TYPESCRIPT_APPLICATION';
  return 'UNKNOWN';
}

// QNBS-v3: classify only the outgoing impact so local admission stays resource-safe without weakening cloud authority.
export function classifyChangedFiles(files) {
  const normalizedFiles = [...new Set(files.map((file) => file.trim()).filter(Boolean))].sort();
  const categories = [...new Set(normalizedFiles.map(classifyFile))];

  if (normalizedFiles.length === 0)
    return { kind: 'NO_CHANGES', categories: [], files: normalizedFiles };
  if (categories.every((category) => category === 'DOCS')) {
    return { kind: 'DOCS_ONLY', categories, files: normalizedFiles };
  }
  if (categories.every((category) => category === 'WORKFLOW')) {
    return { kind: 'WORKFLOW_ONLY', categories, files: normalizedFiles };
  }
  if (categories.length === 1) {
    if (categories[0] === 'UNKNOWN')
      return { kind: 'AMBIGUOUS', categories, files: normalizedFiles };
    return { kind: categories[0], categories, files: normalizedFiles };
  }
  if (
    categories.every((category) => ['DOCS', 'WORKFLOW', 'TOOLING', 'TEST_ONLY'].includes(category))
  ) {
    return { kind: 'NON_CODE_ONLY', categories, files: normalizedFiles };
  }
  if (categories.includes('UNKNOWN'))
    return { kind: 'AMBIGUOUS', categories, files: normalizedFiles };
  return { kind: 'MIXED', categories, files: normalizedFiles };
}

export function requiresTypecheck(classification, { full = false } = {}) {
  if (full) return true;
  return ![
    'NO_CHANGES',
    'DOCS_ONLY',
    'WORKFLOW_ONLY',
    'NON_CODE_ONLY',
    'RUST_TAURI',
    'TOOLING',
    'TEST_ONLY',
  ].includes(classification.kind);
}

export function classifyProcessResult(result) {
  // QNBS-v3: classify timeout, interruption, and signal termination as non-pass local resource failures.
  if (
    ['EAGAIN', 'ENOMEM'].includes(result.error?.code) ||
    result.timedOut ||
    result.interrupted ||
    result.signal ||
    result.status === 137 ||
    result.status === 143
  ) {
    return 'LOCAL_RESOURCE_FAILURE';
  }
  if (result.status === 0) return 'PASS';
  return 'FAIL';
}

export function classifySignatureResult(verified) {
  return verified ? 'PASS' : 'FAIL';
}
