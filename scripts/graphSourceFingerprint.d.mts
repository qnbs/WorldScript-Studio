export const ROOT: string;
export function listSourcePaths(cwd?: string): Array<string | Buffer>;
export function computeSourceFingerprint(cwd?: string): string;
export function matchesExactVersion(output: string, expectedVersion: string): boolean;
export function checkCleanState(cwd?: string): { clean: boolean; dirtyPaths: string[] };
export function buildMetadataBlock(opts: {
  tool: string;
  toolVersion: string;
  generationMode: string;
  reportSchemaVersion: number;
  cwd?: string;
  fingerprint?: string;
}): string;
