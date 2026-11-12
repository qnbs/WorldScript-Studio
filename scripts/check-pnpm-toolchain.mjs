import process from 'node:process';
import { nodeBelowSecurityFloor } from './node-security-floor.mjs';
import { checkDockerfilePnpm, isVersionAtLeast } from './pnpm-version-policy.mjs';

const projectPackage = JSON.parse(
  await (await import('node:fs/promises')).readFile('package.json', 'utf8'),
);
const expectedPackageManager = projectPackage.packageManager;
const expectedPnpmVersion = expectedPackageManager?.startsWith('pnpm@')
  ? expectedPackageManager.slice('pnpm@'.length)
  : null;
const minimumSecurePnpmVersion = '11.11.0';

if (!expectedPnpmVersion) {
  console.error('[toolchain] package.json must pin packageManager to pnpm@<exact-version>.');
  process.exit(1);
}

if (projectPackage.engines?.pnpm !== expectedPnpmVersion) {
  console.error('[toolchain] engines.pnpm must exactly match packageManager.');
  process.exit(1);
}

const dockerfile = await (await import('node:fs/promises'))
  .readFile('Dockerfile', 'utf8')
  .catch(() => null);
if (dockerfile !== null) {
  const dockerPnpm = checkDockerfilePnpm(dockerfile, expectedPnpmVersion);
  if (!dockerPnpm.ok) {
    const problems = [
      ...dockerPnpm.mismatched.map((pin) => `pins pnpm ${pin}`),
      ...dockerPnpm.bypasses.map((line) => `installs pnpm outside packageManager (${line})`),
      ...(dockerPnpm.corepackInstall ? [] : ['has no `RUN corepack install` step']),
      ...(dockerPnpm.versionAssertion
        ? []
        : ['lacks the pnpm version assertion before `pnpm install`']),
    ];
    console.error(
      `[toolchain] Dockerfile ${problems.join('; ')}; take pnpm ${expectedPnpmVersion} from packageManager via \`corepack install\`.`,
    );
    process.exit(1);
  }
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

// Visible, not blocking: the engines range stays open (#1078), and CI cannot get a patch before actions/node-versions publishes it.
const nodeSecurityFloor = nodeBelowSecurityFloor(process.versions.node);
if (nodeSecurityFloor) {
  const message = `Node ${process.versions.node} is below the ${nodeSecurityFloor} security release of its line (#1245); install the newest patch (setup-node check-latest takes it once actions/node-versions publishes it).`;
  console.warn(
    process.env.GITHUB_ACTIONS === 'true' ? `::warning::${message}` : `[toolchain] ${message}`,
  );
}

const isDirectHook = process.argv.includes('--hook');
const userAgentVersion = process.env.npm_config_user_agent?.match(/(?:^|\s)pnpm\/(\S+)/)?.[1];

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
} else if (userAgentVersion !== expectedPnpmVersion) {
  console.error(`[toolchain] pnpm ${expectedPnpmVersion} is required; found ${userAgentVersion}.`);
  process.exit(1);
} else {
  console.log(
    `[toolchain] Node ${process.versions.node} and pnpm ${userAgentVersion} match the project pin.`,
  );
}
