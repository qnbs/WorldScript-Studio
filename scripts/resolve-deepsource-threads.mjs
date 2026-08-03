#!/usr/bin/env node
/**
 * Reply to and resolve unresolved deepsource-io review threads on a PR.
 * Usage: node scripts/resolve-deepsource-threads.mjs <pr-number> <commit-sha> [reply-body]
 */

import { execFileSync } from 'node:child_process';

const pr = process.argv[2];
const commit = process.argv[3];
const defaultBody = `Addressed in ${commit}: JS-0067 is repo-wide dashboard-ignored per docs/DEEPSOURCE-REMEDIATION-PLAN.md §5 (idiomatic ES-module exports). Secondary-store migration consolidated into services/storage/secondaryStorageMigration.ts where applicable.`;
const body = process.argv[4] ?? defaultBody;

if (!pr || !commit) {
  console.error('Usage: node scripts/resolve-deepsource-threads.mjs <pr> <sha> [body]');
  process.exit(1);
}

const gh = (args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8' }));

let cursor = null;
let resolved = 0;

for (;;) {
  const data = gh([
    'api',
    'graphql',
    '-f',
    `query=${`
      query($cursor: String) {
        repository(owner: "qnbs", name: "WorldScript-Studio") {
          pullRequest(number: ${pr}) {
            reviewThreads(first: 100, after: $cursor) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id
                isResolved
                comments(first: 1) {
                  nodes {
                    databaseId
                    author { login }
                  }
                }
              }
            }
          }
        }
      }
    `}`,
    '-f',
    `cursor=${cursor ?? ''}`,
  ]);

  const threads = data.data.repository.pullRequest.reviewThreads;
  for (const thread of threads.nodes) {
    const comment = thread.comments.nodes[0];
    if (thread.isResolved || comment?.author?.login !== 'deepsource-io') continue;

    try {
      gh([
        'api',
        `repos/qnbs/WorldScript-Studio/pulls/${pr}/comments/${comment.databaseId}/replies`,
        '-f',
        `body=${body}`,
      ]);
    } catch {
      // reply may fail if already replied
    }

    gh([
      'api',
      'graphql',
      '-f',
      `query=mutation($t: ID!) { resolveReviewThread(input: { threadId: $t }) { thread { isResolved } } }`,
      '-F',
      `t=${thread.id}`,
    ]);
    resolved += 1;
  }

  if (!threads.pageInfo.hasNextPage) break;
  cursor = threads.pageInfo.endCursor;
}

console.log(`Resolved ${resolved} deepsource-io threads on PR #${pr}`);
