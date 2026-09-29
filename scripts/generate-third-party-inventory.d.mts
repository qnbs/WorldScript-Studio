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
  texts: LicenseText[];
}

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
export function collectJsComponents(
  pnpmLicenses: Record<string, PnpmLicenseEntry[]>,
  readTexts?: ReadLicenseTexts,
): InventoryComponent[];
export function collectRustComponents(
  metadata: CargoMetadata,
  readTexts?: ReadLicenseTexts,
): InventoryComponent[];
export function compareComponents(a: InventoryComponent, b: InventoryComponent): number;
export function classifyComponents(components: InventoryComponent[]): {
  unclassified: string[];
  review: string[];
  missingText: string[];
};
export function licenseEntry(
  expression: string,
): Array<{ expression: string } | { license: { id: string } | { name: string } }>;
export function renderNotices(components: InventoryComponent[], context: InventoryContext): string;
export function renderSbom(components: InventoryComponent[], context: InventoryContext): string;
export function main(argv?: string[]): void;
