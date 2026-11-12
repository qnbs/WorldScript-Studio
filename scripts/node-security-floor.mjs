import { isVersionAtLeast } from './pnpm-version-policy.mjs';

// The newest Node.js security release of each supported line (#1245). Raise an entry with every security release:
// CI and local checks then warn until the runtime catches up, and the Docker builder test requires it.
export const NODE_SECURITY_FLOORS = Object.freeze({
  22: '22.23.5',
  24: '24.22.3',
  26: '26.13.1',
});

/** The security floor `version` is below, or null when it meets its line's floor or its line has none. */
export function nodeBelowSecurityFloor(version) {
  const major = Number.parseInt(String(version).split('.')[0] ?? '', 10);
  const floor = NODE_SECURITY_FLOORS[major];
  if (!floor) return null;
  return isVersionAtLeast(String(version), floor) ? null : floor;
}
