import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { refuse } from './pages-pruning/evidence.mjs';
import { REPOSITORY, WORKFLOW } from './pages-pruning/policy.mjs';
import { reconcilePages } from './pages-pruning/reconcile.mjs';

export {
  admission,
  DESTRUCTIVE_WRITES_ADMITTED,
  planPruning,
  REPOSITORY,
  validateHolds,
} from './pages-pruning/policy.mjs';
export { reconcilePages };

const BACKLOG_REASONS = ['batch-limit', 'budget-limit', 'unexamined'];

export async function runAction({
  github,
  context,
  core,
  holds,
  workflowRef,
  reconcile = reconcilePages,
}) {
  const result = await reconcile({
    github,
    holds,
    authority: {
      repository: `${context.repo.owner}/${context.repo.repo}`,
      eventName: context.eventName,
      ref: context.ref,
      sha: context.sha,
      workflowRef,
    },
  });
  const { manifest, ...summary } = result;
  core.info(JSON.stringify(summary));
  await core.summary
    .addHeading('GitHub Pages record reconciliation')
    .addCodeBlock(JSON.stringify(summary, null, 2), 'json')
    .addCodeBlock(JSON.stringify(manifest, null, 2), 'json')
    .write();
  if (BACKLOG_REASONS.some((key) => result.reasons[key]))
    core.warning?.('Pages record backlog exceeds one bounded pass; see the capacity guidance.');
  if (result.failed)
    core.setFailed('Pages reconciliation failed closed; inspect sanitized counts and reasons.');
}

// QNBS-v3: the local CLI exposes GET only and forces dry-run; credentials never appear in output or request errors.
function readOnlyClient(token) {
  return {
    request: async (route, params = {}) => {
      if (!route.startsWith('GET ')) refuse('local-writes-forbidden');
      const url = new URL(`https://api.github.com${route.slice(4)}`);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
      const response = await fetch(url, {
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok)
        throw Object.assign(new Error('GitHub read failed'), {
          status: response.status,
          response: { headers: Object.fromEntries(response.headers) },
        });
      return { data: await response.json(), headers: Object.fromEntries(response.headers) };
    },
  };
}

// QNBS-v3: the token is requested for github.com explicitly, because GH_HOST or an enterprise default would return a credential for another host, and every request below goes to api.github.com.
export const TOKEN_ARGS = ['auth', 'token', '--hostname', 'github.com'];

async function localDryRun() {
  if (process.argv.length !== 3 || process.argv[2] !== '--dry-run') refuse('invalid-cli-mode');
  const token = execFileSync('gh', TOKEN_ARGS, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  const holdsUrl = new URL('../.github/pages-pruning-holds.json', import.meta.url);
  const result = await reconcilePages({
    github: readOnlyClient(token),
    holds: JSON.parse(readFileSync(holdsUrl, 'utf8')),
    dryRun: true,
    authority: {
      repository: REPOSITORY,
      ref: 'refs/heads/main',
      sha: '0'.repeat(40),
      workflowRef: WORKFLOW,
      eventName: 'workflow_dispatch',
    },
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.failed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  localDryRun().catch(() => {
    process.stderr.write('Read-only Pages inventory failed.\n');
    process.exitCode = 1;
  });
}
