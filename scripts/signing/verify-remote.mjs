#!/usr/bin/env node
import process from 'node:process';

const API = 'https://api.github.com';

function safeText(value, limit = 200) {
  return Array.from(String(value ?? ''), (character) =>
    character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127 ? character : ' ',
  )
    .join('')
    .slice(0, limit);
}

function safeSha(value) {
  return String(value ?? '').match(/^[0-9a-f]{12}/i)?.[0] ?? 'invalid-sha';
}

function safeSubject(message) {
  return (
    safeText(
      String(message ?? '')
        .split(/\r?\n/, 1)[0]
        .slice(0, 160),
    ) || '(subject unavailable)'
  );
}

function safeReport(commit) {
  return {
    sha: safeSha(commit.sha),
    subject: safeSubject(commit.commit?.message),
    verified: commit.commit?.verification?.verified === true,
    reason: safeText(commit.commit?.verification?.reason ?? 'missing verification result'),
  };
}

// QNBS-v3: require a stable protected-main snapshot across the ancestry API request.
async function verifyProtectedMainAncestry({ owner, repo, sha, token, fetchImpl }) {
  const branchUrl = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/main`;
  const branch = await fetchJson(fetchImpl, branchUrl, token);
  const mainSha = String(branch.commit?.sha ?? '').toLowerCase();
  if (branch.name !== 'main' || branch.protected !== true || !/^[0-9a-f]{40}$/.test(mainSha)) {
    throw new Error('protected main branch identity could not be verified');
  }

  const comparison = await fetchJson(
    fetchImpl,
    `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${encodeURIComponent(`${sha}...${mainSha}`)}`,
    token,
  );
  if (
    !['ahead', 'identical'].includes(comparison.status) ||
    comparison.base_commit?.sha?.toLowerCase() !== sha ||
    comparison.merge_base_commit?.sha?.toLowerCase() !== sha
  ) {
    throw new Error('release tag target is not contained in protected main');
  }

  const currentBranch = await fetchJson(fetchImpl, branchUrl, token);
  const currentMainSha = String(currentBranch.commit?.sha ?? '').toLowerCase();
  if (
    currentBranch.name !== 'main' ||
    currentBranch.protected !== true ||
    currentMainSha !== mainSha
  ) {
    throw new Error('protected main changed during ancestry verification');
  }
}

// QNBS-v3: iterative glob match without building a RegExp from the pattern; "*" and "?" never consume a "/".
function globMatches(pattern, text) {
  let p = 0;
  let t = 0;
  let starP = -1;
  let starT = -1;
  while (t < text.length) {
    if (p < pattern.length && pattern[p] === '*') {
      starP = p;
      starT = t;
      p += 1;
    } else if (
      p < pattern.length &&
      (pattern[p] === '?' ? text[t] !== '/' : pattern[p] === text[t])
    ) {
      p += 1;
      t += 1;
    } else if (starP !== -1 && text[starT] !== '/') {
      starT += 1;
      t = starT;
      p = starP + 1;
    } else {
      return false;
    }
  }
  while (pattern[p] === '*') p += 1;
  return p === pattern.length;
}

// QNBS-v3: ruleset ref patterns are fnmatch-like; syntax outside this safe subset, including "**", is unknown (null), never a match.
export function refPatternMatches(pattern, ref) {
  if (pattern === '~ALL') return true;
  if (typeof pattern !== 'string' || !/^[A-Za-z0-9._\-/*?]+$/.test(pattern)) return null;
  if (pattern.includes('**')) return null;
  return globMatches(pattern, ref);
}

const TAG_PROTECTION_RULES = Object.freeze(['creation', 'update', 'deletion', 'non_fast_forward']);
const RULESET_LIST_LIMIT = 100;

// QNBS-v3: github.ref_protected is unreliable for tags, so require active tag rulesets covering creation and immutability (bypass_actors stays admin-only, see docs/VERIFIED-SIGNING.md).
async function verifyTagRulesetProtection({ owner, repo, tag, token, fetchImpl }) {
  const base = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/rulesets`;
  const summaries = await fetchJson(
    fetchImpl,
    `${base}?targets=tag&includes_parents=true&per_page=${RULESET_LIST_LIMIT}`,
    token,
  );
  if (!Array.isArray(summaries) || summaries.length >= RULESET_LIST_LIMIT) {
    throw new Error('tag ruleset list could not be read completely');
  }
  const ref = `refs/tags/${tag}`;
  const covered = new Set();
  for (const summary of summaries) {
    const readable =
      summary?.target === 'tag' &&
      summary.enforcement === 'active' &&
      summary.source_type === 'Repository' &&
      Number.isInteger(summary.id);
    if (!readable) continue;
    const ruleset = await fetchJson(fetchImpl, `${base}/${summary.id}`, token);
    if (ruleset.target !== 'tag' || ruleset.enforcement !== 'active') continue;
    const include = [].concat(ruleset.conditions?.ref_name?.include ?? []);
    const exclude = [].concat(ruleset.conditions?.ref_name?.exclude ?? []);
    const included = include.some((pattern) => refPatternMatches(pattern, ref) === true);
    const excluded = exclude.some((pattern) => refPatternMatches(pattern, ref) !== false);
    if (!included || excluded) continue;
    for (const rule of ruleset.rules ?? []) covered.add(rule?.type);
  }
  const missing = TAG_PROTECTION_RULES.filter((rule) => !covered.has(rule));
  if (missing.length > 0) {
    throw new Error(`release tag is not covered by active tag rulesets for: ${missing.join(', ')}`);
  }
}

export async function fetchJson(fetchImpl, url, token) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`GitHub API request failed (${response.status})`);
  return response.json();
}

export async function fetchPullRequestCommits({
  owner,
  repo,
  number,
  token = '',
  fetchImpl = fetch,
}) {
  const commits = [];
  for (let page = 1; ; page += 1) {
    const batch = await fetchJson(
      fetchImpl,
      `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}/commits?per_page=100&page=${page}`,
      token,
    );
    if (!Array.isArray(batch)) throw new Error('GitHub PR commits response was not an array');
    commits.push(...batch);
    if (batch.length < 100) return commits;
  }
}

export function verifyRemoteCommitReports(commits) {
  const reports = commits.map(safeReport);
  const invalid = reports.find((report) => !report.verified);
  return { ok: !invalid, reports, reason: invalid ? `${invalid.sha}: ${invalid.reason}` : '' };
}

export function hasCompleteCommitRange(expectedShas, reports) {
  if (expectedShas.length !== reports.length) return false;
  return expectedShas.every((sha) => reports.some((report) => sha.startsWith(report.sha)));
}

// QNBS-v3: github.sha is the commit a tag push builds; it is never the push event's "after", which for an annotated tag is the tag object, so the two must not be compared with each other.
export function contextCommitSha(githubSha) {
  const contextSha = String(githubSha ?? '');
  if (!/^[0-9a-f]{40}$/i.test(contextSha))
    throw new Error('GitHub context does not contain a full commit SHA');
  if (/^0{40}$/i.test(contextSha)) throw new Error('GitHub context contains a deleted-ref SHA');
  return contextSha.toLowerCase();
}

// QNBS-v3: the push event must announce a full, live pushed object; it is bound to the annotated tag object the live ref resolves to inside verifyRemoteTag.
export function eventTagObjectSha(eventAfter) {
  const eventSha = String(eventAfter ?? '');
  if (!/^[0-9a-f]{40}$/i.test(eventSha))
    throw new Error('push event does not contain a full pushed tag object SHA');
  if (/^0{40}$/i.test(eventSha))
    throw new Error('push event does not contain a live pushed tag object SHA');
  return eventSha.toLowerCase();
}

export async function verifyRemotePullRequest(options) {
  const commits = await fetchPullRequestCommits(options);
  return verifyRemoteCommitReports(commits);
}

export async function verifyRemoteCommitRange({
  owner,
  repo,
  shas,
  token = '',
  fetchImpl = fetch,
}) {
  const commits = [];
  for (const sha of shas) {
    commits.push(
      await fetchJson(
        fetchImpl,
        `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${sha}`,
        token,
      ),
    );
  }
  return verifyRemoteCommitReports(commits);
}

export async function verifyRemoteTag({
  owner,
  repo,
  tag,
  expectedCommitSha,
  eventAfter,
  token = '',
  fetchImpl = fetch,
}) {
  if (!/^[0-9a-f]{40}$/i.test(String(expectedCommitSha ?? '')))
    throw new Error('expected tag target must be a full commit SHA');
  if (/^0{40}$/i.test(expectedCommitSha))
    throw new Error('expected tag target cannot be the deleted-ref SHA');
  const expectedSha = expectedCommitSha.toLowerCase();
  const eventObjectSha = eventTagObjectSha(eventAfter);
  const refUrl = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/tags/${encodeURIComponent(tag)}`;
  const ref = await fetchJson(fetchImpl, refUrl, token);
  const object = ref.object;
  if (!object?.sha || !object.type) throw new Error('GitHub tag ref response was incomplete');
  if (object.type !== 'tag') {
    const report = {
      sha: safeSha(object.sha),
      subject: safeText(`tag ${tag}`, 160),
      verified: false,
      reason: 'release tag is not an annotated tag object',
    };
    return { ok: false, reports: [report], reason: `${report.sha}: ${report.reason}` };
  }
  // QNBS-v3: the pushed object must be exactly the annotated tag object that is verified below; the SHAs are public and printed in full so a failure shows both values.
  if (!/^[0-9a-f]{40}$/i.test(String(object.sha)))
    throw new Error('GitHub tag ref did not return a full tag object SHA');
  if (eventObjectSha !== object.sha.toLowerCase())
    throw new Error(
      `push event object does not match the live release tag object (event ${eventObjectSha}, tag ${object.sha.toLowerCase()}, expected commit ${expectedSha})`,
    );
  let tagReport = null;
  let targetSha = object.sha;
  const tagObject = await fetchJson(
    fetchImpl,
    `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/tags/${encodeURIComponent(object.sha)}`,
    token,
  );
  if (tagObject.tag !== tag) throw new Error('annotated tag name does not match the pushed ref');
  tagReport = {
    sha: safeSha(object.sha),
    subject: safeText(`tag ${tag}`, 160),
    verified: tagObject.verification?.verified === true,
    reason: safeText(tagObject.verification?.reason ?? 'missing tag verification result'),
  };
  targetSha = tagObject.object?.sha;
  if (tagObject.object?.type !== 'commit' || !targetSha)
    throw new Error('annotated tag does not target a commit');
  if (targetSha.toLowerCase() !== expectedSha) {
    return {
      ok: false,
      reports: [
        tagReport,
        {
          sha: safeSha(targetSha),
          subject: safeText(`tag ${tag}`, 160),
          verified: false,
          reason: 'tag target does not match the pushed event commit',
        },
      ],
      reason: `${safeSha(targetSha)}: tag target does not match the pushed event commit`,
    };
  }
  const commit = await fetchJson(
    fetchImpl,
    `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(targetSha)}`,
    token,
  );
  const commitReport = safeReport(commit);
  const reports = tagReport ? [tagReport, commitReport] : [commitReport];
  const invalid = reports.find((report) => !report.verified);
  if (invalid) return { ok: false, reports, reason: `${invalid.sha}: ${invalid.reason}` };
  await verifyProtectedMainAncestry({ owner, repo, sha: expectedSha, token, fetchImpl });
  await verifyTagRulesetProtection({ owner, repo, tag, token, fetchImpl });
  const currentRef = await fetchJson(fetchImpl, refUrl, token);
  if (currentRef.object?.type !== 'tag' || currentRef.object?.sha !== object.sha) {
    throw new Error('release tag changed during signature verification');
  }
  return { ok: true, reports, reason: '', verifiedTagSha: expectedSha };
}

export { safeReport };

if (process.argv[1]?.endsWith('/verify-remote.mjs')) {
  const [repository, number] = process.argv.slice(2);
  const [owner, repo] = String(repository ?? process.env.GITHUB_REPOSITORY ?? '').split('/', 2);
  if (!owner || !repo || !number) {
    console.error('usage: pnpm run signing:verify-remote -- <owner>/<repo> <pull-request-number>');
    process.exit(2);
  }
  try {
    const result = await verifyRemotePullRequest({
      owner,
      repo,
      number,
      token: process.env.GITHUB_TOKEN ?? '',
    });
    for (const report of result.reports)
      console.log(
        `${report.sha} ${report.verified ? 'verified' : 'REJECTED'} ${report.reason} ${report.subject}`,
      );
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error(
      `remote signature verification failed: ${error instanceof Error ? error.message : 'unexpected API error'}`,
    );
    process.exit(1);
  }
}
