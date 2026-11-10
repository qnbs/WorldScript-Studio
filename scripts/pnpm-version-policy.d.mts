export function parseVersion(version: string): number[] | null;
export function isVersionAtLeast(version: string, minimum: string): boolean;
export function findDockerfilePnpmPins(dockerfile: string): string[];
export function findDockerfilePnpmBypasses(dockerfile: string): string[];
export function checkDockerfilePnpm(
  dockerfile: string,
  expectedVersion: string,
): { ok: boolean; mismatched: string[]; bypasses: string[]; corepackInstall: boolean };
