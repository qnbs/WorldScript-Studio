// Test-only preload for `node --import`: replaces the global fetch with a deterministic model of the GitHub REST
// endpoints that the release-tag gate reads, so the real gate script runs unchanged as a child process.
// The scenario is a JSON file named by the `scenario` query parameter of the --import URL.
import { readFileSync } from 'node:fs';

const scenario = JSON.parse(
  readFileSync(new URL(import.meta.url).searchParams.get('scenario') ?? '', 'utf8'),
);
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const verification = (verified) => ({ verified, reason: verified ? 'valid' : 'unsigned' });
const base = `/repos/${scenario.owner}/${scenario.repo}`;
const summaries = scenario.rulesets.map((ruleset) => ({
  id: ruleset.id,
  target: 'tag',
  enforcement: 'active',
  source_type: 'Repository',
}));

globalThis.fetch = async (input) => {
  const { pathname } = new URL(String(input));
  if (pathname === `${base}/git/ref/tags/${scenario.tag}`) {
    return json({ ref: `refs/tags/${scenario.tag}`, object: scenario.refObject });
  }
  if (pathname === `${base}/git/tags/${scenario.tagObject.sha}`) {
    return json({
      tag: scenario.tagObject.name,
      object: { sha: scenario.tagObject.targetSha, type: 'commit' },
      verification: verification(scenario.tagObject.verified),
    });
  }
  if (pathname === `${base}/commits/${scenario.commit.sha}`) {
    return json({
      sha: scenario.commit.sha,
      commit: { message: 'release', verification: verification(scenario.commit.verified) },
    });
  }
  if (pathname === `${base}/branches/main`) {
    return json({ name: 'main', protected: true, commit: { sha: scenario.mainSha } });
  }
  if (pathname.startsWith(`${base}/compare/`)) {
    return json({
      status: scenario.mainSha === scenario.commit.sha ? 'identical' : 'ahead',
      base_commit: { sha: scenario.commit.sha },
      merge_base_commit: { sha: scenario.commit.sha },
    });
  }
  if (pathname === `${base}/rulesets`) return json(summaries);
  const ruleset = scenario.rulesets.find((entry) => pathname === `${base}/rulesets/${entry.id}`);
  if (ruleset) {
    return json({
      id: ruleset.id,
      target: 'tag',
      enforcement: 'active',
      conditions: { ref_name: { include: ['refs/tags/v*'], exclude: [] } },
      rules: ruleset.rules.map((type) => ({ type })),
    });
  }
  return json({ message: 'Not Found' }, 404);
};
