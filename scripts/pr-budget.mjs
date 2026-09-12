import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  evaluatePrSize,
  evaluatePrSizeSnapshot,
  getCommitCount,
  getStagedNumstat,
  hasStagedChanges,
  PR_SIZE_TIERS,
  parseNumstat,
  selectBudgetMode,
} from './check-pr-size.mjs';

function run(command, args, dependencies = {}) {
  const spawn = dependencies.spawnSync ?? spawnSync;
  const result = spawn(command, args, { encoding: 'utf8', timeout: 5_000 });
  if (result.error || result.status !== 0) return null;
  return (result.stdout ?? '').trim();
}

function resolveCommit(ref, dependencies = {}) {
  if (typeof ref !== 'string' || ref.length === 0) return null;
  return run('git', ['rev-parse', '--verify', `${ref}^{commit}`], dependencies);
}

function readPullRequestEvent(dependencies = {}) {
  const env = dependencies.env ?? process.env;
  if (env.GITHUB_EVENT_NAME !== 'pull_request') return null;
  if (!env.GITHUB_EVENT_PATH) return null;
  const readFile = dependencies.readFileSync ?? readFileSync;
  try {
    return pullRequestEventRefs(JSON.parse(readFile(env.GITHUB_EVENT_PATH, 'utf8')));
  } catch {
    return null;
  }
}

function pullRequestEventRefs(payload) {
  const pullRequest = payload?.pull_request;
  const baseSha = pullRequest?.base?.sha;
  const baseRef = pullRequest?.base?.ref;
  const headRef = pullRequest?.head?.ref;
  if (typeof baseSha !== 'string' && typeof baseRef !== 'string') return null;
  if (typeof headRef !== 'string') return null;
  return { baseSha, baseRef, headRef };
}

function currentBranch(dependencies = {}) {
  return run('git', ['branch', '--show-current'], dependencies);
}

function livePullRequestBase(dependencies = {}) {
  const branch = currentBranch(dependencies);
  if (!branch) return null;
  const raw = run('gh', ['pr', 'view', '--json', 'baseRefName,headRefName,state'], dependencies);
  if (!raw) return null;
  try {
    return livePullRequestRef(JSON.parse(raw), branch);
  } catch {
    return null;
  }
}

function livePullRequestRef(pullRequest, branch) {
  if (pullRequest?.state !== 'OPEN') return null;
  if (pullRequest?.headRefName !== branch) return null;
  if (typeof pullRequest?.baseRefName !== 'string') return null;
  return pullRequest.baseRefName;
}

function checkedBase(ref, source, dependencies = {}) {
  const sha = resolveCommit(ref, dependencies);
  return sha
    ? { ok: true, base: sha, requested: ref, source }
    : { ok: false, error: `could not verify ${source} PR base ${ref}` };
}

// QNBS-v3: an unresolved PR base must be visible and fail closed instead of silently measuring the wrong range.
export function resolveBudgetBase({ explicitBase, allowLive = true, dependencies = {} } = {}) {
  if (explicitBase) return checkedBase(explicitBase, 'explicit', dependencies);

  const event = readPullRequestEvent(dependencies);
  if (event) {
    return checkedBase(event.baseSha ?? event.baseRef, 'pull-request event', dependencies);
  }

  if (allowLive) {
    const baseRef = livePullRequestBase(dependencies);
    if (baseRef) {
      const remote = checkedBase(`origin/${baseRef}`, 'live', dependencies);
      if (remote.ok) return remote;
      const local = checkedBase(baseRef, 'live', dependencies);
      if (local.ok) return local;
      return remote;
    }
  }

  return {
    ok: false,
    error: 'PR base is unresolved; provide an explicit --base <ref> (no main fallback was used)',
  };
}

const setFlag = (property, value) => (options) => {
  options[property] = value;
  return 0;
};

const setValue = (property) => (options, argv, index) => {
  const value = argv[index + 1];
  if (!value) throw new Error(`--${property} requires a value`);
  options[property] = value;
  return 1;
};

const OPTION_HANDLERS = {
  '--': setFlag('separator', true),
  '--base': setValue('base'),
  '--head': setValue('head'),
  '--prospective': setFlag('prospective', true),
  '--staged': setFlag('prospective', true),
  '--prepush': setFlag('prepush', true),
  '--no-live': setFlag('allowLive', false),
  '--help': setFlag('help', true),
};

function parseArguments(argv) {
  const options = { head: 'HEAD', allowLive: true, prospective: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const handler = OPTION_HANDLERS[argument];
    if (!handler) throw new Error(`unknown option ${argument}`);
    index += handler(options, argv, index);
  }
  return options;
}

export function evaluateProspectivePrSize(base, head, dependencies = {}) {
  const numstat = getStagedNumstat(base, dependencies);
  const staged = hasStagedChanges(dependencies);
  const currentCommitCount = getCommitCount(base, head, dependencies);
  if ([numstat, staged, currentCommitCount].some((value) => value === null)) {
    return { ok: false, error: 'could not resolve the staged prospective range via git' };
  }
  const rows = parseNumstat(numstat);
  return evaluatePrSizeSnapshot(
    base,
    head,
    numstat,
    currentCommitCount + Number(staged),
    dependencies,
    rows.map((row) => row.path),
  );
}

function budgetLineCount(result) {
  return result.exception?.applied ? result.nonExemptLineCount : result.lineCount;
}

function printBudget(result, { base, head, subject }) {
  const lineCount = budgetLineCount(result);
  const mode = selectBudgetMode({
    fileCount: result.fileCount,
    lineCount,
    commitCount: result.commitCount,
    allDocs: result.allDocs,
  });
  const limits = result.exception?.applied ? result.severity.limits : PR_SIZE_TIERS.absolute;
  const status = result.severity.blocking ? 'BLOCKED' : mode === 'SATURATED' ? 'FREEZE' : 'OK';
  console.log('PR_BUDGET');
  console.log(`base=${base}`);
  console.log(`head=${head}`);
  console.log(`subject=${subject}`);
  console.log(`files=${result.fileCount}`);
  console.log(`meaningful_lines=${lineCount}`);
  console.log(`commits=${result.commitCount}`);
  console.log(`limit_files=${limits.files}`);
  console.log(`limit_meaningful_lines=${limits.lines}`);
  console.log(`limit_commits=${limits.commits}`);
  console.log(`reserve_files=${limits.files - result.fileCount}`);
  console.log(`reserve_meaningful_lines=${limits.lines - lineCount}`);
  console.log(`reserve_commits=${limits.commits - result.commitCount}`);
  console.log(`mode=${mode}`);
  console.log(`status=${status}`);
  if (result.report) console.log(`canonical_report=${result.report}`);
  return status === 'BLOCKED' ? 1 : 0;
}

export function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    console.error(`[pr-budget] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return 1;
  }
  if (options.help) {
    console.log(
      'Usage: pnpm run pr:budget -- [--base <ref>] [--head <ref>] [--prospective] [--no-live]',
    );
    return 0;
  }

  const resolution = resolveBudgetBase({
    explicitBase: options.base,
    allowLive: options.allowLive,
  });
  if (!resolution.ok) {
    console.log('PR_BUDGET');
    console.log('status=UNRESOLVED_BASE');
    console.log(`error=${resolution.error}`);
    process.exitCode = 2;
    return 2;
  }

  const result = options.prospective
    ? evaluateProspectivePrSize(resolution.base, options.head, {})
    : evaluatePrSize(resolution.base, options.head);
  if (!result.ok) {
    console.log('PR_BUDGET');
    console.log('status=BLOCKED');
    console.log(`error=${result.error}`);
    process.exitCode = 1;
    return 1;
  }
  const subject = options.prospective ? 'STAGED_PROSPECTIVE' : 'COMMITTED_HEAD';
  const status = printBudget(result, {
    base: resolution.base,
    head: options.head,
    subject,
  });
  process.exitCode = status;
  return status;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
