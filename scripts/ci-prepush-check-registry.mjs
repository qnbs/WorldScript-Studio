import { isI18nPolicyFile } from './ci-prepush-classifier.mjs';

const routingAuthority = 'scripts/ci-prepush-check-registry.mjs';
const isGithubYaml = (file) => file.startsWith('.github/') && /\.(?:yml|yaml)$/i.test(file);

export const admissionCheckRegistry = Object.freeze([
  {
    name: 'i18n',
    matches: (file) =>
      file.startsWith('locales/') || file.startsWith('public/locales/') || isI18nPolicyFile(file),
    implementationFiles: new Set([routingAuthority, 'scripts/ci-prepush-classifier.mjs']),
  },
  {
    name: 'workflowPolicy',
    // QNBS-v3: route every parsed GitHub YAML policy input through its governing check.
    matches: isGithubYaml,
    implementationFiles: new Set([
      routingAuthority,
      'scripts/ci-prepush-classifier.mjs',
      'scripts/check-workflow-policy.mjs',
      'scripts/workflow-policy-guards.mjs',
      'scripts/workflow-policy-parser.mjs',
      'scripts/workflow-policy-guards.d.mts',
    ]),
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
