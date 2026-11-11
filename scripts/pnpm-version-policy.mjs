import { logicalLines } from './check-dockerfile-context.mjs';

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

// One string per Dockerfile instruction, parsed like Docker: comment lines dropped, then backslash continuations joined.
const contentLines = (dockerfile) => logicalLines(String(dockerfile));

/** Every explicit `pnpm@<version>` pin in a Dockerfile (comments ignored). */
export function findDockerfilePnpmPins(dockerfile) {
  return contentLines(dockerfile).flatMap((line) =>
    [...line.matchAll(/\bpnpm@([^\s"'\\]+)/g)].map((match) => match[1]),
  );
}

// Scope: a drift guard over the Dockerfile text, not a shell sandbox. The semantic proof is the version assertion inside the build (VERSION_ASSERTION, required below), which fails for any pnpm that is not the packageManager pin, and the build check runs that build on every pull request.
// Common ways to get pnpm that bypass package.json#packageManager.
const PNPM_BYPASSES = [
  /\b(?:npm|yarn)\b[^#]*\b(?:i|install|add)\b[^#]*\bpnpm\b/,
  /\b(?:npx|npm\s+exec|dlx)\b[^#]*\bpnpm\b/,
  /\bcorepack\s+(?:prepare|use)\b/,
  /\bget\.pnpm\.io\b/,
];
// `corepack install` at a command position of a RUN instruction; the keyword is case-insensitive, the shell command is not.
// No `#` before it, since a shell comment would swallow the rest of the line.
const COREPACK_INSTALL = /^[Rr][Uu][Nn]\s+(?:[^#]*(?:&&|;)\s*)?corepack\s+install\b/;
// The in-build assertion that the active pnpm equals the packageManager pin, directly before the install.
const VERSION_ASSERTION =
  /^[Rr][Uu][Nn]\s+test "\$\(pnpm --version\)" = "\$\(node -p "require\('\.\/package\.json'\)\.packageManager\.split\('@'\)\[1\]\.split\('\+'\)\[0\]"\)" && pnpm install --frozen-lockfile$/;

/** Dockerfile lines that install pnpm without reading `packageManager` (comments ignored). */
export function findDockerfilePnpmBypasses(dockerfile) {
  return contentLines(dockerfile).filter((line) =>
    PNPM_BYPASSES.some((pattern) => pattern.test(line)),
  );
}

/**
 * The image must take pnpm only from `packageManager`: a `RUN corepack install` step, the in-build
 * version assertion before `pnpm install`, and no other pnpm installer (no explicit pin, no global
 * install, no npx/npm exec/dlx, no Corepack prepare or use).
 */
export function checkDockerfilePnpm(dockerfile, expectedVersion) {
  const lines = contentLines(dockerfile);
  const mismatched = findDockerfilePnpmPins(dockerfile).filter((pin) => pin !== expectedVersion);
  const bypasses = findDockerfilePnpmBypasses(dockerfile);
  const corepackInstall = lines.some((line) => COREPACK_INSTALL.test(line));
  // Every pnpm install must be the asserted instruction, so no install runs before the version is verified.
  const installs = lines.filter((line) => /\bpnpm\s+(?:install|i|add)\b/.test(line));
  const versionAssertion =
    installs.length > 0 && installs.every((line) => VERSION_ASSERTION.test(line));
  const ok = [
    corepackInstall,
    versionAssertion,
    bypasses.length === 0,
    mismatched.length === 0,
  ].every(Boolean);
  return { ok, mismatched, bypasses, corepackInstall, versionAssertion };
}
