import type { Buffer } from 'node:buffer';

export const REPORT_PATH: string;
export const DB_PATH: string;
export function resolveCodegraphCommand(): string;
export function executeCodegraph(
  args: string[],
  options?: Record<string, unknown>,
): {
  status: number | null;
  stdout?: string | Buffer | null;
  stderr?: string | Buffer | null;
  error?: Error;
};
export function redactPaths(text: string, opts?: { root?: string; home?: string }): string;
export function sanitize(text: string, opts?: { root?: string; home?: string }): string;
export function validateIndexStatus(status: unknown, expectedVersion: string): unknown;
export function validateFileList(
  fileList: Array<{ path: string }>,
  expectedCount: number,
): Array<{ path: string }>;
export function formatExtensionLines(fileList: Array<{ path: string }>): string;
export function generateReport(): number;
