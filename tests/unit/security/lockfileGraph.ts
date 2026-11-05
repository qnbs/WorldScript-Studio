export type LockfileSection = Record<string, { version: string }>;

export type Lockfile = {
  importers?: Record<
    string,
    { dependencies?: LockfileSection; optionalDependencies?: LockfileSection }
  >;
  packages?: Record<string, unknown>;
  snapshots?: Record<
    string,
    { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }
  >;
};

type Importer = NonNullable<Lockfile['importers']>[string];
type Snapshot = NonNullable<Lockfile['snapshots']>[string];

export type AffectedRule = {
  name: string;
  introduced: string;
  fixed?: string;
  lastAffected?: string;
};

const SECTIONS = ['dependencies', 'optionalDependencies'] as const;

export function compareNumericVersionTriples(left: string, right: string): number {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  const firstDifference = [0, 1, 2]
    .map((index) => (leftParts[index] ?? 0) - (rightParts[index] ?? 0))
    .find((difference) => difference !== 0);
  return firstDifference ?? 0;
}

export function isAffected(version: string, rule: AffectedRule): boolean {
  if (compareNumericVersionTriples(version, rule.introduced) < 0) return false;
  if (rule.fixed !== undefined) return compareNumericVersionTriples(version, rule.fixed) < 0;
  if (rule.lastAffected === undefined) return true;
  return compareNumericVersionTriples(version, rule.lastAffected) <= 0;
}

export function bareKey(key: string): string {
  return key.split('(')[0] ?? key;
}

export function splitKey(key: string): [string, string] {
  const bare = bareKey(key);
  const at = bare.lastIndexOf('@');
  return [bare.slice(0, at), bare.slice(at + 1)];
}

const isRegistryKey = (key: string): boolean => !key.includes('@link:');

function importerRoots(importer: Importer): string[] {
  return SECTIONS.flatMap((section) =>
    Object.entries(importer[section] ?? {}).map(([name, entry]) => `${name}@${entry.version}`),
  );
}

function childKeys(snapshot: Snapshot | undefined): string[] {
  return SECTIONS.flatMap((section) =>
    Object.entries(snapshot?.[section] ?? {}).map(([name, reference]) => `${name}@${reference}`),
  ).filter(isRegistryKey);
}

/**
 * Every package reachable from the dependencies and optionalDependencies of any workspace
 * importer. pnpm records resolved peer dependencies inside each snapshot's dependencies, so they
 * are followed too. Lockfile-graph evidence only: it says nothing about the built bundle.
 */
export function productionReachable(lockfile: Lockfile): Set<string> {
  const seen = new Set<string>();
  const stack = Object.values(lockfile.importers ?? {})
    .flatMap(importerRoots)
    .filter(isRegistryKey);
  for (let key = stack.pop(); key !== undefined; key = stack.pop()) {
    if (seen.has(key)) continue;
    seen.add(key);
    stack.push(...childKeys(lockfile.snapshots?.[key]));
  }
  return new Set([...seen].map(bareKey));
}

function referencesVersion(reference: string | undefined, version: string): boolean {
  return reference === version || (reference?.startsWith(`${version}(`) ?? false);
}

export function parentPackages(lockfile: Lockfile, name: string, version: string): string[] {
  const parents = Object.entries(lockfile.snapshots ?? {})
    .filter(([, snapshot]) =>
      SECTIONS.some((section) => referencesVersion(snapshot[section]?.[name], version)),
    )
    .map(([key]) => splitKey(key)[0]);
  return [...new Set(parents)].sort();
}
