export function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match ? match.slice(1).map(Number) : null;
}

export function isVersionAtLeast(version, minimum) {
  const actualParts = parseVersion(version);
  const minimumParts = parseVersion(minimum);
  if (!actualParts || !minimumParts) return false;

  for (let index = 0; index < 3; index += 1) {
    const actualPart = actualParts[index];
    const minimumPart = minimumParts[index];
    if (actualPart > minimumPart) return true;
    if (actualPart < minimumPart) return false;
  }

  return true;
}

const contentLines = (dockerfile) =>
  String(dockerfile)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));

/** Every explicit `pnpm@<version>` pin in a Dockerfile (comments ignored). */
export function findDockerfilePnpmPins(dockerfile) {
  return contentLines(dockerfile).flatMap((line) =>
    [...line.matchAll(/\bpnpm@([^\s"'\\]+)/g)].map((match) => match[1]),
  );
}

// Ways to get pnpm that bypass package.json#packageManager: a global npm or yarn install, a Corepack prepare or use step, or the standalone installer.
const PNPM_BYPASSES = [
  /\b(?:npm|yarn)\b[^#]*\b(?:i|install|add)\b[^#]*\bpnpm\b/,
  /\bcorepack\s+(?:prepare|use)\b/,
  /\bget\.pnpm\.io\b/,
];
const COREPACK_INSTALL = /^RUN\b.*\bcorepack\s+install\b/;

/** Dockerfile lines that install pnpm without reading `packageManager` (comments ignored). */
export function findDockerfilePnpmBypasses(dockerfile) {
  return contentLines(dockerfile).filter((line) =>
    PNPM_BYPASSES.some((pattern) => pattern.test(line)),
  );
}

/**
 * The image must take pnpm only from `packageManager`: a `RUN corepack install` step and no other
 * pnpm installer (no explicit pin, no global install, no Corepack prepare or use).
 */
export function checkDockerfilePnpm(dockerfile, expectedVersion) {
  const mismatched = findDockerfilePnpmPins(dockerfile).filter((pin) => pin !== expectedVersion);
  const bypasses = findDockerfilePnpmBypasses(dockerfile);
  const corepackInstall = contentLines(dockerfile).some((line) => COREPACK_INSTALL.test(line));
  const ok = [corepackInstall, bypasses.length === 0, mismatched.length === 0].every(Boolean);
  return { ok, mismatched, bypasses, corepackInstall };
}
