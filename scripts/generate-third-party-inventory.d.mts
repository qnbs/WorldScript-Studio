export const AUTO_ACCEPTED_LICENSES: ReadonlySet<string>;

export interface LicenseText {
  file: string;
  text: string;
}

export interface InventoryComponent {
  ecosystem: 'npm' | 'cargo';
  name: string;
  version: string;
  license: string | null;
  homepage: string | null;
  /** Copyright holders from the package metadata (cargo `authors`, npm `author`). */
  authors?: string[];
  texts: LicenseText[];
}

/** Returns the canonical SPDX text for a license id, or null when none is pinned. */
export type ReadCanonicalText = (id: string) => string | null;

export interface InventoryContext {
  version: string;
  commit: string;
  target: string;
  timestamp: string;
}

export type ReadLicenseTexts = (
  directory: string | undefined,
  extraFiles?: string[],
) => LicenseText[];

export interface PnpmLicenseEntry {
  name: string;
  versions: string[];
  paths: string[];
  license?: string;
  homepage?: string;
  author?: string;
}

export interface PnpmLockfileNode {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

export interface PnpmLockfile {
  importers?: Record<
    string,
    {
      dependencies?: Record<string, { version: string }>;
      optionalDependencies?: Record<string, { version: string }>;
      devDependencies?: Record<string, { version: string }>;
    }
  >;
  snapshots?: Record<string, PnpmLockfileNode | null>;
}

export interface CargoMetadata {
  packages: Array<{
    id: string;
    name: string;
    version: string;
    source: string | null;
    license?: string | null;
    license_file?: string | null;
    homepage?: string | null;
    repository?: string | null;
    manifest_path: string;
    targets: Array<{ kind: string[] }>;
  }>;
  resolve: {
    root: string;
    nodes: Array<{
      id: string;
      deps: Array<{ pkg: string; dep_kinds: Array<{ kind: string | null }> }>;
    }>;
  };
}

export function normalizeLicenseExpression(raw: unknown): string | null;
export function isAutoAccepted(expression: string): boolean;
export function packageUrl(ecosystem: 'npm' | 'cargo', name: string, version: string): string;
export function readLicenseTexts(
  directory: string | undefined,
  extraFiles?: string[],
): LicenseText[];
export function productionPackageKeys(lockfile: PnpmLockfile): Set<string>;
export function collectJsComponents(
  pnpmLicenses: Record<string, PnpmLicenseEntry[]>,
  readTexts?: ReadLicenseTexts,
  isShipped?: (name: string, version: string) => boolean,
): InventoryComponent[];
export function collectRustComponents(
  metadata: CargoMetadata,
  readTexts?: ReadLicenseTexts,
): InventoryComponent[];
export function compareComponents(a: InventoryComponent, b: InventoryComponent): number;
export function licenseIdsOf(expression: string | null): string[];
export function canonicalLicenseTexts(
  expression: string | null,
  readCanonical?: ReadCanonicalText,
): LicenseText[];
export function classifyComponents(
  components: InventoryComponent[],
  readCanonical?: ReadCanonicalText,
): {
  unclassified: string[];
  review: string[];
  missingText: string[];
  withoutAnyText: string[];
};
export function licenseEntry(
  expression: string,
): Array<{ expression: string } | { license: { id: string } | { name: string } }>;
export function renderNotices(
  components: InventoryComponent[],
  context: InventoryContext,
  readCanonical?: ReadCanonicalText,
): string;
export function renderSbom(components: InventoryComponent[], context: InventoryContext): string;
export function main(argv?: string[]): void;
