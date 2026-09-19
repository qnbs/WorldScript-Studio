#!/usr/bin/env node
/**
 * Read-only live reviewer evidence for a PR. Requires an authenticated `gh` in the execution
 * context. It never comments, resolves threads, reruns jobs, or prints credential values.
 */
import { execFileSync } from 'node:child_process';
import process from 'node:process';

process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(name + ' requires a value');
  return value;
}

const MAX_PULL_REQUEST_NUMBER = '2147483647';

function isValidPullRequestNumber(value) {
  return (
    /^[1-9]\d*$/.test(value) &&
    (value.length < MAX_PULL_REQUEST_NUMBER.length ||
      (value.length === MAX_PULL_REQUEST_NUMBER.length && value <= MAX_PULL_REQUEST_NUMBER))
  );
}

function parseRepository(value) {
  if (!/^[^/\s]+\/[^/\s]+$/.test(value)) throw new Error('--repo must be exactly owner/name');
  const [owner, name] = value.split('/');
  return { fullName: value, owner, name };
}

let pr;
let repo;
try {
  pr = argument('--pr');
  if (!pr || !isValidPullRequestNumber(pr))
    throw new Error('--pr must be a positive pull request number within GraphQL Int range');
  repo = parseRepository(
    argument('--repo') ?? process.env.GITHUB_REPOSITORY ?? 'qnbs/WorldScript-Studio',
  );
} catch (error) {
  console.error('[reviewers] ' + error.message);
  console.error('Usage: pnpm run reviewers:status -- --pr <number> [--repo owner/name]');
  process.exit(2);
}

function ghJson(args) {
  try {
    const output = execFileSync('gh', ['api', ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 8 * 1024 * 1024,
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

function fetchCheckRuns(path) {
  const pages = flatPages(ghJson(['--paginate', '--slurp', path]));
  return pages.flatMap((page) => page?.check_runs ?? []);
}

function fetchCommitStatuses(path) {
  const pages = flatPages(ghJson(['--paginate', '--slurp', path]));
  return pages.flatMap((page) => page?.statuses ?? []);
}

function writeLine(line) {
  process.stdout.write(line + '\n');
}

function safeUrl(value) {
  return typeof value === 'string' && value.startsWith('https://github.com/')
    ? value
    : 'unavailable';
}

function terminalValue(value) {
  return JSON.stringify(value ?? 'unknown');
}

function evidenceLine(channel, item) {
  const provider = item.user?.login ?? item.author?.login ?? 'unknown';
  const id = item.id ?? item.database_id ?? item.node_id ?? 'unknown';
  const state = item.state ?? item.review ?? item.conclusion ?? 'unknown';
  const bodyAvailable = typeof item.body === 'string' && item.body.length > 0;
  return (
    '  ' +
    channel +
    ' provider=' +
    terminalValue(provider) +
    ' id=' +
    terminalValue(id) +
    ' state=' +
    terminalValue(state) +
    ' path=' +
    terminalValue(item.path ?? 'none') +
    ' line=' +
    terminalValue(item.line ?? item.original_line ?? 'unknown') +
    ' inReplyTo=' +
    terminalValue(item.in_reply_to_id ?? 'none') +
    ' bodyAvailable=' +
    bodyAvailable +
    ' url=' +
    safeUrl(item.html_url ?? item.url)
  );
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
  const pull = ghJson([`repos/${repo.fullName}/pulls/${pr}`]);
  const checks = fetchCheckRuns(
    `repos/${repo.fullName}/commits/${pull.head.sha}/check-runs?per_page=100`,
  );
  const commitStatuses = fetchCommitStatuses(
    `repos/${repo.fullName}/commits/${pull.head.sha}/status?per_page=100`,
  );
  const issueComments = fetchPages(`repos/${repo.fullName}/issues/${pr}/comments?per_page=100`);
  const inlineComments = fetchPages(`repos/${repo.fullName}/pulls/${pr}/comments?per_page=100`);
  const reviews = fetchPages(`repos/${repo.fullName}/pulls/${pr}/reviews?per_page=100`);
  const query =
    'query($owner:String!,$name:String!,$number:Int!,$endCursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100,after:$endCursor){nodes{id isResolved isOutdated path line comments(first:1){nodes{databaseId author{login} body}}} pageInfo{hasNextPage endCursor}}}}}';
  const threadPages = ghJson([
    'graphql',
    '--paginate',
    '--slurp',
    '-f',
    `owner=${repo.owner}`,
    '-f',
    `name=${repo.name}`,
    '-F',
    `number=${pr}`,
    '-f',
    `query=${query}`,
  ]);
  const threads = flatPages(threadPages).flatMap(
    (page) => page?.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [],
  );
  const finalPull = ghJson([`repos/${repo.fullName}/pulls/${pr}`]);
  if (finalPull.head?.sha !== pull.head?.sha)
    throw new Error(
      'pull request head changed during evidence collection; rerun for one exact head',
    );

  writeLine('reviewers:status repo=' + repo.fullName + ' pr=' + pr + ' head=' + finalPull.head.sha);
  writeLine(
    'state=' + finalPull.state + ' merged=' + finalPull.merged + ' base=' + finalPull.base.ref,
  );
  writeLine('checks:');
  for (const check of checks)
    writeLine(
      `  checkName=${terminalValue(check.name)} status=${check.status}/${check.conclusion ?? 'pending'}`,
    );
  writeLine(`commitStatuses total=${commitStatuses.length}`);
  for (const status of commitStatuses) {
    writeLine(
      `  commitStatus id=${terminalValue(status.id)} context=${terminalValue(status.context)} state=${terminalValue(status.state)} descriptionAvailable=${Boolean(status.description)} url=${safeUrl(status.target_url)}`,
    );
  }
  writeLine(
    `reviewThreads total=${threads.length} unresolved=${threads.filter((thread) => !thread.isResolved).length}`,
  );
  for (const thread of threads) {
    const comment = thread.comments?.nodes?.[0] ?? thread.comments?.[0];
    writeLine(
      `  inlineThread id=${terminalValue(thread.id)} rootCommentId=${terminalValue(comment?.databaseId)} provider=${terminalValue(comment?.author?.login)} resolved=${thread.isResolved} outdated=${thread.isOutdated} path=${terminalValue(thread.path)} line=${terminalValue(thread.line ?? 'unknown')} bodyAvailable=${Boolean(comment?.body)}`,
    );
  }
  writeLine(
    `topLevelComments total=${issueComments.length} by=${JSON.stringify(providerCounts(issueComments))}`,
  );
  writeLine(
    `inlineComments total=${inlineComments.length} by=${JSON.stringify(providerCounts(inlineComments))}`,
  );
  writeLine(`reviewBodies total=${reviews.length} by=${JSON.stringify(providerCounts(reviews))}`);
  writeLine('reviewEvidence:');
  for (const item of issueComments) writeLine(evidenceLine('topLevelComment', item));
  for (const item of inlineComments) writeLine(evidenceLine('inlineComment', item));
  for (const item of reviews) writeLine(evidenceLine('reviewBody', item));
} catch (error) {
  console.error(`[reviewers] UNKNOWN — ${error.message}`);
  process.exitCode = 1;
}
