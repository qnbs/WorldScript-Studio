import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const scopePath = path.join(repositoryRoot, 'stryker-scope.json');

export const scope = JSON.parse(readFileSync(scopePath, 'utf8'));

function validateScope(scopeDefinition) {
  if (!Array.isArray(scopeDefinition.modules) || scopeDefinition.modules.length === 0) {
    throw new Error('Stryker scope must define at least one module.');
  }

  const moduleNames = new Set();
  const mutationFiles = new Set();
  for (const module of scopeDefinition.modules) {
    if (
      !module ||
      typeof module.name !== 'string' ||
      !['A', 'B'].includes(module.riskTier) ||
      !Array.isArray(module.mutate)
    ) {
      throw new Error('Every Stryker scope module needs a name, riskTier (A/B), and mutate array.');
    }
    if (moduleNames.has(module.name)) throw new Error(`Duplicate Stryker module: ${module.name}`);
    moduleNames.add(module.name);
    if (module.mutate.length === 0)
      throw new Error(`Stryker module has no targets: ${module.name}`);
    for (const file of module.mutate) {
      if (typeof file !== 'string' || mutationFiles.has(file)) {
        throw new Error(`Duplicate or invalid Stryker target: ${file}`);
      }
      if (!existsSync(path.join(repositoryRoot, file))) {
        throw new Error(`Stryker target does not exist: ${file}`);
      }
      mutationFiles.add(file);
    }
  }
  return { moduleNames, mutationFiles };
}

const validatedScope = validateScope(scope);
export const mutationFiles = [...validatedScope.mutationFiles];
export const mutationModules = scope.modules.map(({ name, riskTier, mutate }) => ({
  name,
  riskTier,
  mutate: mutate.join(','),
}));

export function selectMutationModules(selector = 'all') {
  if (selector === 'all') return mutationModules;
  if (selector === 'tier-a') return mutationModules.filter(({ riskTier }) => riskTier === 'A');
  const selected = mutationModules.filter(({ name }) => name === selector);
  if (selected.length === 0) {
    throw new Error(
      `Unknown Stryker scope selector "${selector}". Use all, tier-a, or one of: ${mutationModules
        .map(({ name }) => name)
        .join(', ')}`,
    );
  }
  return selected;
}

// QNBS-v3: Generate the CI matrix from the same target definition used by Stryker itself.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const selectorIndex = process.argv.indexOf('--selector');
  const selector = selectorIndex === -1 ? 'all' : process.argv[selectorIndex + 1];
  const selectedModules = selectMutationModules(selector);
  if (process.argv.includes('--matrix')) {
    process.stdout.write(`${JSON.stringify(selectedModules)}\n`);
  } else if (process.argv.includes('--files')) {
    process.stdout.write(
      `${selectedModules.flatMap(({ mutate }) => mutate.split(',')).join(',')}\n`,
    );
  } else {
    process.stdout.write(
      `Validated ${selectedModules.reduce((count, { mutate }) => count + mutate.split(',').length, 0)} Stryker targets across ${selectedModules.length} modules.\n`,
    );
  }
}
