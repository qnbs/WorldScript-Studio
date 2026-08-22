import process from 'node:process';

const projectPackage = JSON.parse(
  await (await import('node:fs/promises')).readFile('package.json', 'utf8'),
);
const expectedPackageManager = projectPackage.packageManager;
const expectedPnpmVersion = expectedPackageManager?.startsWith('pnpm@')
  ? expectedPackageManager.slice('pnpm@'.length)
  : null;
const minimumSecurePnpmVersion = '11.11.0';

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match ? match.slice(1).map(Number) : null;
}

function isVersionAtLeast(version, minimum) {
  const actualParts = parseVersion(version);
  const minimumParts = parseVersion(minimum);
  if (!actualParts || !minimumParts) return false;
  return (
    actualParts.some((part, index) => {
      if (part !== minimumParts[index]) return part > minimumParts[index];
      return false;
    }) || actualParts.every((part, index) => part === minimumParts[index])
  );
}

if (!expectedPnpmVersion) {
  console.error('[toolchain] package.json must pin packageManager to pnpm@<exact-version>.');
  process.exit(1);
}

if (projectPackage.engines?.pnpm !== expectedPnpmVersion) {
  console.error('[toolchain] engines.pnpm must exactly match packageManager.');
  process.exit(1);
}

if (!isVersionAtLeast(expectedPnpmVersion, minimumSecurePnpmVersion)) {
  console.error(
    `[toolchain] pnpm ${expectedPnpmVersion} is below the security floor ${minimumSecurePnpmVersion}.`,
  );
  process.exit(1);
}

const minimumNodeMajor = Number.parseInt(
  projectPackage.engines?.node?.match(/\d+/)?.[0] ?? '0',
  10,
);
const actualNodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
if (actualNodeMajor < minimumNodeMajor) {
  console.error(
    `[toolchain] Node ${minimumNodeMajor}+ is required; found ${process.versions.node}.`,
  );
  process.exit(1);
}

const isDirectHook = process.argv.includes('--hook');
const userAgentVersion = process.env.npm_config_user_agent?.match(/(?:^|\s)pnpm\/(\S+)/)?.[1];
if (userAgentVersion && userAgentVersion !== expectedPnpmVersion) {
  console.error(`[toolchain] pnpm ${expectedPnpmVersion} is required; found ${userAgentVersion}.`);
  process.exit(1);
}

if (!userAgentVersion) {
  if (isDirectHook) {
    console.warn(
      '[toolchain] Direct hook path cannot inspect pnpm metadata; run pnpm run toolchain:check for the strict version check.',
    );
  } else {
    console.error(
      '[toolchain] Could not determine the active pnpm version. Run this check through pnpm/Corepack.',
    );
    process.exit(1);
  }
} else {
  console.log(
    `[toolchain] Node ${process.versions.node} and pnpm ${userAgentVersion} match the project pin.`,
  );
}
