const routingAuthority = 'scripts/ci-prepush-check-registry.mjs';
const runnerAuthority = 'scripts/ci-prepush-lowend.mjs';
const i18nPolicyFiles = new Set([
  'scripts/check-i18n-keys.mjs',
  'scripts/i18n-locales.mjs',
  'scripts/build-i18n.mjs',
  'scripts/i18n-quality-report.mjs',
]);

// QNBS-v3: not exported — shouldRunAdmissionCheck is the public API, nothing else consumes this.
const admissionCheckRegistry = Object.freeze([
  {
    name: 'i18n',
    matches: (file) =>
      file.startsWith('locales/') ||
      file.startsWith('public/locales/') ||
      i18nPolicyFiles.has(file),
    implementationFiles: new Set([
      routingAuthority,
      runnerAuthority,
      'scripts/ci-prepush-classifier.mjs',
      'scripts/ci-prepush-range-resolver.mjs',
    ]),
  },
  {
    name: 'contentGuard',
    matches: (file) =>
      file === 'scripts/content-guard.mjs' ||
      file.startsWith('community-templates/') ||
      file.startsWith('public/community-templates/'),
    implementationFiles: new Set([
      routingAuthority,
      runnerAuthority,
      'scripts/ci-prepush-classifier.mjs',
      'scripts/ci-prepush-range-resolver.mjs',
    ]),
  },
  {
    name: 'workflowPolicy',
    // QNBS-v3: composite actions carry the same uses:-pin risk as workflows themselves.
    matches: (file) =>
      file.startsWith('.github/workflows/') || file.startsWith('.github/actions/'),
    implementationFiles: new Set([
      routingAuthority,
      runnerAuthority,
      'scripts/ci-prepush-classifier.mjs',
      'scripts/ci-prepush-range-resolver.mjs',
      'scripts/workflow-policy-check.mjs',
    ]),
  },
]);

export function shouldRunAdmissionCheck(name, files) {
  const entry = admissionCheckRegistry.find((candidate) => candidate.name === name);
  if (!entry) throw new Error(`unknown local admission check: ${name}`);
  return files.some((file) => entry.matches(file) || entry.implementationFiles.has(file));
}
