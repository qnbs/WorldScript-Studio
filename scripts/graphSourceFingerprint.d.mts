export const ROOT: string;
export function listSourcePaths(cwd?: string): string[];
export function computeSourceFingerprint(cwd?: string): string;
export function checkCleanState(cwd?: string): { clean: boolean; dirtyPaths: string[] };
export function buildMetadataBlock(opts: {
  tool: string;
  toolVersion: string;
  generationMode: string;
  reportSchemaVersion: number;
  cwd?: string;
}): string;
