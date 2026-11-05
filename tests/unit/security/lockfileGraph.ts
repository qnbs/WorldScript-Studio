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

export type PackageRef = { name: string; version: string };

/** Parses a lockfile key such as `name@1.2.3(peer@4.5.6)` into its package reference. */
export function parseKey(key: string): PackageRef {
  const bare = key.split('(')[0] ?? key;
  const at = bare.lastIndexOf('@');
  return { name: bare.slice(0, at), version: bare.slice(at + 1) };
}

const registryOnly = (key: string): boolean => !key.includes('@link:');

function importerRoots(importer: Importer): string[] {
  return SECTIONS.flatMap((section) =>
    Object.entries(importer[section] ?? {}).map(([name, entry]) => `${name}@${entry.version}`),
  );
}

function childKeys(snapshot: Snapshot | undefined): string[] {
  return SECTIONS.flatMap((section) =>
    Object.entries(snapshot?.[section] ?? {}).map(([name, reference]) => `${name}@${reference}`),
  ).filter(registryOnly);
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
    .filter(registryOnly);
  for (let key = stack.pop(); key !== undefined; key = stack.pop()) {
    if (seen.has(key)) continue;
    seen.add(key);
    stack.push(...childKeys(lockfile.snapshots?.[key]));
  }
  return new Set(
    [...seen].map((key) => {
      const ref = parseKey(key);
      return `${ref.name}@${ref.version}`;
    }),
  );
}

function referencesVersion(dependencies: Record<string, string> | undefined, ref: PackageRef) {
  const reference = dependencies?.[ref.name];
  return reference === ref.version || (reference?.startsWith(`${ref.version}(`) ?? false);
}

export function parentPackages(lockfile: Lockfile, ref: PackageRef): string[] {
  const parents = Object.entries(lockfile.snapshots ?? {})
    .filter(([, snapshot]) => SECTIONS.some((section) => referencesVersion(snapshot[section], ref)))
    .map(([key]) => parseKey(key).name);
  return [...new Set(parents)].sort();
}
