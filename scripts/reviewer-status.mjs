#!/usr/bin/env node
/**
 * Read-only live reviewer evidence for a PR. Requires an authenticated `gh` in the execution
 * context. It never comments, resolves threads, reruns jobs, or prints credential values.
 */
import { execFileSync } from 'node:child_process';
import process from 'node:process';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const pr = argument('--pr');
if (!pr || !/^\d+$/.test(pr)) {
  console.error('Usage: pnpm run reviewers:status -- --pr <number> [--repo owner/name]');
  process.exit(2);
}

const repo = argument('--repo') ?? process.env.GITHUB_REPOSITORY ?? 'qnbs/WorldScript-Studio';
const ghEnvironment = { ...process.env };
delete ghEnvironment.GH_TOKEN;
delete ghEnvironment.GITHUB_TOKEN;

function ghJson(args) {
  try {
    const output = execFileSync('gh', ['api', ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: ghEnvironment,
    });
    return JSON.parse(output);
  } catch (error) {
    throw new Error(
      `GitHub read failed (${args.join(' ')}): ${error.stderr?.trim() || error.message}`,
    );
  }
}

function flatPages(value) {
  return Array.isArray(value) ? value.flat() : value;
}

function firstLine(body) {
  return String(body ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

function safeEvidence(body) {
  return firstLine(body)
    .replace(/\[vc\]:\s*\S+/gi, '[vc]: [REDACTED]')
    .replace(/(token|cookie|authorization|secret|password)=\S+/gi, '$1=[REDACTED]');
}

function providerCounts(items) {
  return items.reduce((counts, item) => {
    const login = item.user?.login ?? item.author?.login ?? 'unknown';
    counts[login] = (counts[login] ?? 0) + 1;
    return counts;
  }, {});
}

function fetchPages(path) {
  return flatPages(ghJson(['--paginate', '--slurp', path]));
}

try {
  const pull = ghJson([`repos/${repo}/pulls/${pr}`]);
  const checks =
    ghJson([`repos/${repo}/commits/${pull.head.sha}/check-runs?per_page=100`]).check_runs ?? [];
  const issueComments = fetchPages(`repos/${repo}/issues/${pr}/comments?per_page=100`);
  const inlineComments = fetchPages(`repos/${repo}/pulls/${pr}/comments?per_page=100`);
  const reviews = fetchPages(`repos/${repo}/pulls/${pr}/reviews?per_page=100`);
  const query =
    'query($owner:String!,$name:String!,$number:Int!,$endCursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100,after:$endCursor){nodes{id isResolved isOutdated path line comments(first:1){nodes{databaseId author{login} body}}} pageInfo{hasNextPage endCursor}}}}}';
  const threadPages = ghJson([
    'graphql',
    '--paginate',
    '--slurp',
    '-f',
    `owner=${repo.split('/')[0]}`,
    '-f',
    `name=${repo.split('/')[1]}`,
    '-F',
    `number=${pr}`,
    '-f',
    `query=${query}`,
  ]);
  const threads = flatPages(threadPages).flatMap(
    (page) => page?.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [],
  );

  console.log(`reviewers:status repo=${repo} pr=${pr} head=${pull.head.sha}`);
  console.log(`state=${pull.state} merged=${pull.merged} base=${pull.base.ref}`);
  console.log('checks:');
  for (const check of checks)
    console.log(`  ${check.name}\t${check.status}/${check.conclusion ?? 'pending'}`);
  console.log(
    `reviewThreads total=${threads.length} unresolved=${threads.filter((thread) => !thread.isResolved).length}`,
  );
  console.log(
    `topLevelComments total=${issueComments.length} by=${JSON.stringify(providerCounts(issueComments))}`,
  );
  console.log(
    `inlineComments total=${inlineComments.length} by=${JSON.stringify(providerCounts(inlineComments))}`,
  );
  console.log(`reviewBodies total=${reviews.length} by=${JSON.stringify(providerCounts(reviews))}`);
  console.log('reviewEvidence:');
  for (const item of [...issueComments, ...inlineComments, ...reviews]) {
    const login = item.user?.login ?? 'unknown';
    const body = safeEvidence(item.body);
    if (body) console.log(`  ${login}: ${body}`);
  }
} catch (error) {
  console.error(`[reviewers] UNKNOWN — ${error.message}`);
  process.exitCode = 1;
}
