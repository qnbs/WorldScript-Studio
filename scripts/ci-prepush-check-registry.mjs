const routingAuthority = 'scripts/ci-prepush-check-registry.mjs';
const i18nPolicyFiles = new Set([
  'scripts/check-i18n-keys.mjs',
  'scripts/i18n-locales.mjs',
  'scripts/build-i18n.mjs',
  'scripts/i18n-quality-report.mjs',
]);

export const admissionCheckRegistry = Object.freeze([
  {
    name: 'i18n',
    matches: (file) =>
      file.startsWith('locales/') ||
      file.startsWith('public/locales/') ||
      i18nPolicyFiles.has(file),
    implementationFiles: new Set([routingAuthority, 'scripts/ci-prepush-classifier.mjs']),
  },
  {
    name: 'contentGuard',
    matches: (file) =>
      file === 'scripts/content-guard.mjs' ||
      file.startsWith('community-templates/') ||
      file.startsWith('public/community-templates/'),
    implementationFiles: new Set([routingAuthority, 'scripts/ci-prepush-classifier.mjs']),
  },
]);

export function shouldRunAdmissionCheck(name, files) {
  const entry = admissionCheckRegistry.find((candidate) => candidate.name === name);
  if (!entry) throw new Error(`unknown local admission check: ${name}`);
  return files.some((file) => entry.matches(file) || entry.implementationFiles.has(file));
}
