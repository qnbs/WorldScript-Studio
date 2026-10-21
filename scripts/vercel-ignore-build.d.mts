export const PREVIEW_MARKER: string;

export const BUILD_RELEVANT: readonly RegExp[];

export interface BuildDecision {
  build: boolean;
  reason: string;
}

export function decideBuild(input: {
  env: Record<string, string | undefined>;
  changedFiles: readonly string[] | null;
}): BuildDecision;

export function changedSince(previous: string | undefined): string[] | null;
