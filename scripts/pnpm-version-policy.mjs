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
