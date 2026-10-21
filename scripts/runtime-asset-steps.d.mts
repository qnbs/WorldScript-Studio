export const RUNTIME_ASSET_SCRIPTS: readonly string[];

export interface EdgeBuildSpawnResult {
  status: number | null;
}

export type EdgeBuildSpawn = (
  command: string,
  args: readonly string[],
  options: { stdio: 'inherit'; env?: Record<string, string | undefined> },
) => EdgeBuildSpawnResult;

export function runEdgeBuild(input: {
  spawn: EdgeBuildSpawn;
  scriptsDir: string;
  env: Record<string, string | undefined>;
  log?: (message: string) => void;
}): number;
