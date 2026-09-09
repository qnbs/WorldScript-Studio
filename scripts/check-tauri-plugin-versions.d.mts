export function resolvedCargoPluginVersions(cargoLock: string): Map<string, string | null>;
export function resolvedPnpmImporterVersions(pnpmLock: string): Map<string, Map<string, string>>;
export function findTauriPluginVersionMismatches(
  cargoLock: string,
  pnpmLock: string,
  importerPackages: Array<{ importer: string; pkg: { dependencies?: Record<string, string> } }>,
): string[];
