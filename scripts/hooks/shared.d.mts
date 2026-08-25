export interface BoundedResult {
  status: number | null;
  signal: string | null;
  error: Error | null;
  timedOut: boolean;
  interrupted: boolean;
  command: string;
}

export interface RunOptions {
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  input?: string;
  shell?: boolean;
  cwd?: string;
  root?: string;
  detached?: boolean;
}

export function ensureDependencyState(root?: string): boolean;

export function runBounded(
  command: string,
  args: string[],
  options?: RunOptions,
): Promise<BoundedResult>;

export function runNodeScriptDetailed(
  script: string,
  args?: string[],
  options?: RunOptions,
): Promise<BoundedResult>;

export function runNodeScript(
  script: string,
  args?: string[],
  options?: RunOptions,
): Promise<number>;

export function runLocalBinaryDetailed(
  binary: string,
  args?: string[],
  options?: RunOptions,
): Promise<BoundedResult>;

export function runLocalBinary(
  binary: string,
  args?: string[],
  options?: RunOptions,
): Promise<number>;
