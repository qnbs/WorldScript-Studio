export const MINIMUM_DOMPURIFY: string;
export function dompurifyVersionsIn(text: string): string[];
export function checkBundleDompurify(
  files: { name: string; text: string }[],
  minimum?: string,
): { ok: boolean; versions: string[]; files: string[]; errors: string[] };
