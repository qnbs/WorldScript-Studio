export function findTauriPluginVersionMismatches(
  cargoLock: string,
  pkg: { dependencies?: Record<string, string> },
): string[];
