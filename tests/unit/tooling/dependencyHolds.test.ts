// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Hold {
  ecosystem: string;
  directory: string;
  dependency: string;
  versions: string;
  pinned: string;
  issue: number;
}
interface IgnoreRule {
  'dependency-name': string;
  versions?: string[];
}
interface Update {
  'package-ecosystem': string;
  directory: string;
  ignore?: IgnoreRule[];
}

const holds = (
  JSON.parse(readFileSync('config/dependency-holds.json', 'utf8')) as { holds: Hold[] }
).holds;
const updates = (parse(readFileSync('.github/dependabot.yml', 'utf8')) as { updates: Update[] })
  .updates;
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

describe('dependency holds are enforced by configuration, not memory (#1183)', () => {
  it.each(holds.map((hold) => [hold.dependency, hold]))(
    '%s has a matching Dependabot ignore rule',
    (_name, hold) => {
      const update = updates.find(
        (entry) =>
          entry['package-ecosystem'] === hold.ecosystem && entry.directory === hold.directory,
      );
      expect(update, `${hold.ecosystem} ${hold.directory}`).toBeDefined();
      const rule = update?.ignore?.find((entry) => entry['dependency-name'] === hold.dependency);
      expect(rule?.versions).toContain(hold.versions);
      expect(hold.issue).toBeGreaterThan(0);
    },
  );

  it.each(holds.filter((hold) => hold.ecosystem === 'npm').map((hold) => [hold.dependency, hold]))(
    '%s stays on its exact pinned version in package.json',
    (_name, hold) => {
      const declared =
        pkg.dependencies?.[hold.dependency] ?? pkg.devDependencies?.[hold.dependency];
      expect(declared).toBe(hold.pinned);
    },
  );

  it('keeps Dependabot as the only update bot: Renovate is disabled by one explicit config', () => {
    // QNBS-v3: two dormant Renovate configs automerged npm minor/patch updates past every hold.
    expect(existsSync('renovate.json')).toBe(false);
    const renovate = JSON.parse(readFileSync('.github/renovate.json', 'utf8')) as Record<
      string,
      unknown
    >;
    expect(renovate['enabled']).toBe(false);
    expect(renovate).not.toHaveProperty('packageRules');
  });
});
