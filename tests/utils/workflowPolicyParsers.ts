import { dirname, relative, resolve } from 'node:path';

export function extractJobBlock(workflowSource: string, jobName: string): string {
  const lines = workflowSource.split('\n');
  const start = lines.indexOf(`  ${jobName}:`);
  if (start === -1) throw new Error(`Could not find CI job: ${jobName}`);
  const end = lines.findIndex((line, index) => index > start && /^ {2}[\w-]+:$/.test(line));
  return lines.slice(start, end === -1 ? lines.length : end).join('\n');
}

// QNBS-v3: Named step extraction keeps policy assertions scoped to the active workflow step.
export function extractStepBlock(jobBlock: string, stepName: string): string {
  const lines = jobBlock.split('\n');
  const start = lines.indexOf(`      - name: ${stepName}`);
  if (start === -1) throw new Error(`Could not find workflow step: ${stepName}`);
  const end = lines.findIndex((line, index) => index > start && /^ {6}- name: /.test(line));
  return lines.slice(start, end === -1 ? lines.length : end).join('\n');
}

export function extractRustClassifiers(workflowSource: string): {
  tauri: RegExp;
  crates: RegExp;
} {
  const changesJob = extractJobBlock(workflowSource, 'changes');
  const matches = [...changesJob.matchAll(/grep -qE '([^']+)' <<< "\$CHANGED"/g)];
  if (matches.length < 2 || matches[0]?.[1] === undefined || matches[1]?.[1] === undefined) {
    throw new Error('The changes job must expose Tauri and Core path classifiers');
  }
  return { tauri: new RegExp(matches[0][1]), crates: new RegExp(matches[1][1]) };
}

export function extractNeeds(workflowSource: string, jobName: string): string[] {
  const match = extractJobBlock(workflowSource, jobName).match(/^ {4}needs:\s*\[([^\]]+)\]/m);
  if (!match?.[1]) return [];
  return match[1]
    .split(',')
    .map((job) => job.trim())
    .filter(Boolean);
}

export function extractJobNames(workflowSource: string): string[] {
  const jobsSection = workflowSource.slice(workflowSource.indexOf('\njobs:\n'));
  return [...jobsSection.matchAll(/^ {2}([\w-]+):$/gm)]
    .map(([, name]) => name)
    .filter((name): name is string => name !== undefined);
}

export function extractLocalPathDependencies(cargoSource: string): string[] {
  return [...cargoSource.matchAll(/\bpath\s*=\s*"([^"]+)"/g)]
    .map(([, pathValue]) => pathValue)
    .filter((pathValue): pathValue is string => pathValue !== undefined);
}

export function resolveDependencyPrefix(
  dependencyPath: string,
  manifestPath: string,
  repositoryRoot: string,
): string {
  const resolvedPath = relative(
    repositoryRoot,
    resolve(dirname(manifestPath), dependencyPath),
  ).replaceAll('\\', '/');
  if (!resolvedPath || resolvedPath.startsWith('../')) {
    throw new Error(`Tauri path dependency escapes the repository: ${dependencyPath}`);
  }
  return `${resolvedPath.split('/')[0]}/`;
}
