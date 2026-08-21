export function stripHistoricalSections(markdown: string): string;
export function getActualLocaleCount(): number;
export function getActualKeyCount(): number;
export function getLatestReleasedVersion(): string | null;
export function getTaggedVersions(): Set<string>;
export function scanReleaseTruth(
  changelog: string,
  packageVersion: string,
  taggedVersions: Set<string>,
): string[];
export function scanReadmeReleaseTruth(readme: string, taggedVersions: Set<string>): string[];
export function scanUnreleasedTruth(
  changelog: string,
  postReleaseCommitSubjects: string[] | null,
  packageVersion?: string,
  taggedVersions?: Set<string>,
): string[];
export function scanForDrift(
  content: string,
  filePath: string,
  actual: { localeCount: number; keyCount: number; latestVersion: string | null },
): string[];
export function getCanonicalProductionUrl(): string;
export function scanForUrlDrift(content: string, filePath: string, canonicalUrl: string): string[];
export const VERCEL_URL_PATTERN: RegExp;
