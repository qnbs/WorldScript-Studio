export interface BoundedResult {
  status: number | null;
  signal: string | null;
  error: Error | null;
  timedOut: boolean;
  interrupted: boolean;
  command: string;
}

export function runBounded(
  command: string,
  args: string[],
  options?: {
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    input?: string;
    shell?: boolean;
    cwd?: string;
    root?: string;
  },
): Promise<BoundedResult>;
