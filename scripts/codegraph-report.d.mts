export const REPORT_PATH: string;
export const DB_PATH: string;
export function redactPaths(text: string, opts?: { root?: string; home?: string }): string;
export function sanitize(text: string, opts?: { root?: string; home?: string }): string;
export function generateReport(): number;
