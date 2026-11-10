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

/** Every explicit `pnpm@<version>` pin in a Dockerfile (comments ignored). */
export function findDockerfilePnpmPins(dockerfile) {
  const pins = [];
  for (const rawLine of String(dockerfile).split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('#')) continue;
    for (const match of line.matchAll(/\bpnpm@([^\s"'\\]+)/g)) pins.push(match[1]);
  }
  return pins;
}

/**
 * The container must resolve pnpm from `packageManager`: either no explicit pin (Corepack reads
 * package.json) or only pins equal to the project pin.
 */
export function checkDockerfilePnpm(dockerfile, expectedVersion) {
  const mismatched = findDockerfilePnpmPins(dockerfile).filter((pin) => pin !== expectedVersion);
  return mismatched.length === 0 ? { ok: true, mismatched } : { ok: false, mismatched };
}
