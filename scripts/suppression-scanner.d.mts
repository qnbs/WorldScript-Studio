export const SRC_EXTENSIONS: ReadonlySet<string>;
export const BIOME_IGNORE: RegExp;

export interface TrackedSourceCollectorOptions {
  root?: string;
  listTrackedFiles?: (root: string) => string;
}

export function collectTrackedSourceFiles(options?: TrackedSourceCollectorOptions): string[];

export interface SuppressionScanResult {
  total: number;
  byRule: Record<string, number>;
}

export function scanSuppressionText(text: string): SuppressionScanResult;

export function scanSuppressionFiles(
  files: string[],
  readFile?: (file: string) => string,
): SuppressionScanResult & {
  byFile: Record<string, Record<string, number>>;
};
