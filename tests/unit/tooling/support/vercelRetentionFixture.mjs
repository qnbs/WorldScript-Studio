import {
  CANONICAL_ALIASES,
  REQUIRED_RUNS,
  SCOPE,
} from '../../../../scripts/vercel-retention/scope.mjs';

export const MAIN = 'a'.repeat(40);
export const SECRET = 'creator-secret@example.test';
export const sha = (n) => n.toString(16).padStart(40, '0');

export function preview(n, overrides = {}) {
  const { meta, ...rest } = overrides;
  return {
    uid: `dpl_prev${n}`,
    projectId: SCOPE.projectId,
    readyState: 'READY',
    readySubstate: 'STAGED',
    target: null,
    isRollbackCandidate: false,
    created: 1000 + n,
    creator: { username: 'qnbs', email: SECRET },
    meta: {
      githubOrg: SCOPE.org,
      githubRepo: SCOPE.repo,
      githubCommitRef: 'feat/open',
      githubCommitSha: sha(n),
      githubPrId: '9',
      ...meta,
    },
    ...rest,
  };
}

export const production = (uid, commit, overrides = {}) => ({
  ...preview(0, { meta: { githubCommitSha: commit, githubPrId: undefined } }),
  uid,
  target: 'production',
  readySubstate: 'PROMOTED',
  ...overrides,
});

export const greenRuns = (commit = MAIN) =>
  REQUIRED_RUNS.map((name) => ({
    name,
    status: 'completed',
    conclusion: 'success',
    event: 'push',
    headBranch: 'main',
    headSha: commit,
  }));

const alias = (host, deploymentId, created) => ({ alias: host, deploymentId, created });

// Open PR 9 has five previews, closed PR 7 two (one aliased), and one preview has no PR.
export function standardWorld() {
  const current = production('dpl_prod', MAIN, { created: 5000 });
  const older = production('dpl_old', sha(0xb), { isRollbackCandidate: true, created: 4000 });
  const open = [1, 2, 3, 4, 5].map((n) => preview(n));
  const closed = [11, 12].map((n) =>
    preview(n, { meta: { githubCommitRef: 'fix/gone', githubPrId: '7' } }),
  );
  const loose = preview(21, { meta: { githubCommitRef: 'chore/loose', githubPrId: undefined } });
  return {
    main: MAIN,
    runs: greenRuns(),
    deployments: [current, older, ...open, ...closed, loose],
    aliases: [
      ...CANONICAL_ALIASES.map((host, index) => alias(host, current.uid, 100 + index)),
      alias('worldscript-studio-git-feat-open-qnbs-projects.vercel.app', 'dpl_prev5', 200),
      alias('worldscript-studio-git-fix-gone-qnbs-projects.vercel.app', 'dpl_prev12', 201),
      alias('worldscript-studio-git-chore-loose-qnbs-projects.vercel.app', 'dpl_prev21', 202),
    ],
    prs: [{ number: 9, headRefName: 'feat/open', headRefOid: sha(5) }],
    branches: new Set(['main', 'feat/open', 'chore/loose']),
    project: {
      id: SCOPE.projectId,
      name: SCOPE.project,
      accountId: SCOPE.teamId,
      link: { org: SCOPE.org, repo: SCOPE.repo },
    },
    holdFile: { review: [] },
    http: '200',
    pageSize: 100,
    endless: false,
    dirty: '',
    differs: false,
    package: {
      scripts: {
        'vercel:retention:dry-run': 'node scripts/vercel-retention/cli.mjs dry-run',
        'vercel:retention:reconcile': 'node scripts/vercel-retention/cli.mjs reconcile',
      },
    },
    removeFault: {},
    hooks: {},
    locked: false,
    released: 0,
    calls: [],
    writes: [],
  };
}

function page(items, params, key, size) {
  const sorted = [...items].sort((a, b) => b.created - a.created);
  const until = Number(params.get('until'));
  const start = params.has('until') ? sorted.findIndex((item) => item.created < until) : 0;
  const slice = start < 0 ? [] : sorted.slice(start, start + size);
  const more = start >= 0 && start + size < sorted.length;
  const next = more ? slice.at(-1).created : null;
  return { [key]: slice, pagination: { count: slice.length, next } };
}

const API_ROUTES = [
  [/^\/v9\/projects\//, (world) => world.project],
  [
    /^\/v6\/deployments$/,
    (world, params) => page(world.deployments, params, 'deployments', world.pageSize),
  ],
  [/^\/v4\/aliases$/, (world, params) => page(world.aliases, params, 'aliases', world.pageSize)],
];

function readApi(world, path) {
  const [route, query = ''] = path.split('?');
  const hit = API_ROUTES.find(([pattern]) => pattern.test(route));
  if (!hit) throw new Error(`unexpected provider path ${route}`);
  return hit[1](world, new URLSearchParams(query));
}

const REMOVE_FAULTS = {
  'throw-before': () => {
    throw new Error(`403 for ${SECRET}`);
  },
  skip: () => 'skip',
};

function removeDeployment(world, id) {
  const fault = world.removeFault[id];
  const early = REMOVE_FAULTS[fault]?.();
  if (early === 'skip') return;
  const bound = world.aliases.some((entry) => entry.deploymentId === id);
  if (bound) return;
  world.deployments = world.deployments.filter((deployment) => deployment.uid !== id);
  if (fault === 'throw-after') throw new Error('timeout');
}

function removeAliasEntry(world, host) {
  if (world.removeFault[host] === 'alias-fail') throw new Error('alias failure');
  world.aliases = world.aliases.filter((entry) => entry.alias !== host);
}

function mutate(world, args) {
  world.writes.push(args.join(' '));
  world.hooks.onWrite?.(world, args);
  if (args[0] === 'alias') removeAliasEntry(world, args[2]);
  else removeDeployment(world, args[1]);
  return '';
}

const mainRead = (world) => {
  const main = typeof world.main === 'function' ? world.main() : world.main;
  return `${main}\trefs/heads/main\n`;
};

const GIT = {
  main: mainRead,
  heads: (world) => [...world.branches].map((name) => `${sha(1)}\trefs/heads/${name}`).join('\n'),
  status: (world) => world.dirty,
  diff: (world) => {
    if (world.differs) throw new Error('differs');
    return '';
  },
  show: (world) => JSON.stringify(world.package),
};

function gitKey(args) {
  if (args[0] !== 'ls-remote') return args[0];
  return args[1] === 'origin' ? 'main' : 'heads';
}

function git(world, args) {
  world.calls.push(`git ${args[0]}`);
  return (GIT[gitKey(args)] ?? (() => ''))(world);
}

function gh(world, args) {
  world.calls.push(`gh ${args[0]}`);
  world.hooks.onRead?.(world, args);
  return JSON.stringify(args[0] === 'run' ? world.runs : world.prs);
}

// 'new' keeps returning a record nobody has seen (the page limit must stop it); 'same' returns the identical page again (the stall check must stop it).
function endlessPage(world) {
  world.pages = (world.pages ?? 0) + 1;
  const uid = world.endless === 'same' ? 'dpl_same' : `dpl_endless${world.pages}`;
  return JSON.stringify({ deployments: [{ uid }], pagination: { next: 1 } });
}

function vercel(world, args) {
  world.calls.push(`vercel ${args[0]}`);
  if (args[0] !== 'api') return mutate(world, args);
  if (world.hooks.failReads) throw new Error(SECRET);
  if (world.endless && args[1].startsWith('/v6/deployments')) return endlessPage(world);
  return JSON.stringify(readApi(world, args[1]));
}

function lock(world) {
  if (world.locked) throw Object.assign(new Error('busy'), { reason: 'retention-already-running' });
  world.locked = true;
  return () => {
    world.locked = false;
    world.released += 1;
  };
}

export function makeDeps(world) {
  return {
    git: (args) => git(world, args),
    gh: (args) => gh(world, args),
    vercel: (args) => vercel(world, args),
    http: () => world.http,
    packageJson: () => JSON.stringify(world.package),
    holds: () => JSON.stringify(world.holdFile),
    lock: () => lock(world),
    sleep: async () => {},
  };
}
