#!/usr/bin/env node
/**
 * Vercel "Ignored Build Step" (`vercel.json` `ignoreCommand`): exit 1 builds, exit 0 skips.
 *
 * Previews build on demand (owner decision 2026-10-21). Production always builds. A Preview builds
 * on the branch's first deployment, when the commit message contains `[preview]`, or when a file
 * that changes how Vercel installs, builds or serves the app changed since the branch's last
 * successful deployment. Anything unknown builds (fail-open): a broken check can only cost a build,
 * never hide one. A skipped build still creates a canceled deployment, so this saves build minutes,
 * not the deployment count.
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const PREVIEW_MARKER = '[preview]';

/** Files whose change alone still builds a Preview: deployment config, install and build inputs. */
export const BUILD_RELEVANT = [
  /^vercel\.json$/,
  /^vite\.config\.[cm]?[jt]s$/,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^\.npmrc$/,
  /^\.nvmrc$/,
  // Workspace package manifests and pnpm patches change what the install step resolves.
  /^packages\/[^/]+\/package\.json$/,
  /^patches\//,
  /^scripts\/(build-edge|runtime-asset-steps|sync-deploy-base|dependency-state)\.mjs$/,
  /^scripts\/copy-[\w-]+\.mjs$/,
  /^api\//,
];

const SHA = /^[0-9a-f]{7,40}$/;

/**
 * @param {{ env: Record<string, string | undefined>, changedFiles: string[] | null }} input
 * `changedFiles` is null when the diff since the previous deployment is unavailable.
 */
export function decideBuild({ env, changedFiles }) {
  if (env['VERCEL_ENV'] !== 'preview') return { build: true, reason: 'not-a-preview' };
  const message = (env['VERCEL_GIT_COMMIT_MESSAGE'] ?? '').toLowerCase();
  if (message.includes(PREVIEW_MARKER)) return { build: true, reason: 'preview-requested' };
  if (!env['VERCEL_GIT_PREVIOUS_SHA']) return { build: true, reason: 'first-deployment' };
  if (changedFiles === null) return { build: true, reason: 'diff-unavailable' };
  const relevant = changedFiles.find((file) => BUILD_RELEVANT.some((rule) => rule.test(file)));
  if (relevant) return { build: true, reason: `build-file-changed:${relevant}` };
  return { build: false, reason: 'no-build-file-changed' };
}

/** Files changed since `previous`; null when it is not a commit SHA or not in the (shallow) clone. */
export function changedSince(previous) {
  if (!SHA.test(previous ?? '')) return null;
  try {
    const out = execFileSync('git', ['diff', '--name-only', previous, 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\n').filter(Boolean);
  } catch {
    return null;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const previous = process.env['VERCEL_GIT_PREVIOUS_SHA'];
  const changedFiles = previous ? changedSince(previous) : null;
  const decision = decideBuild({ env: process.env, changedFiles });
  console.log(`[vercel-ignore-build] ${decision.build ? 'build' : 'skip'}: ${decision.reason}`);
  process.exit(decision.build ? 1 : 0);
}
