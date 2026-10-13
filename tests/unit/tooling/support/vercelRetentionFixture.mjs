import {
  CANONICAL_ALIASES,
  REQUIRED_RUNS,
  SCOPE,
} from '../../../../scripts/vercel-retention/scope.mjs';

export const MAIN = 'a'.repeat(40);
export const SECRET = 'creator-secret@example.test';
const sha = (n) => n.toString(16).padStart(40, '0');

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
    runs: REQUIRED_RUNS.map((name) => ({ name, status: 'completed', conclusion: 'success' })),
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
    calls: [],
    writes: [],
  };
}

const page = (items, params, key, size) => {
  const sorted = [...items].sort((a, b) => b.created - a.created);
  const start = params.has('until')
    ? sorted.findIndex((i) => i.created < Number(params.get('until')))
    : 0;
  const slice = start < 0 ? [] : sorted.slice(start, start + size);
  const last = slice.at(-1);
  const more = start >= 0 && start + size < sorted.length;
  return { [key]: slice, pagination: { count: slice.length, next: more ? last.created : null } };
};

function readApi(world, path) {
  const [route, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  if (route.startsWith('/v9/projects/')) return world.project;
  if (route === '/v6/deployments')
    return page(world.deployments, params, 'deployments', world.pageSize);
  if (route === '/v4/aliases') return page(world.aliases, params, 'aliases', world.pageSize);
  throw new Error(`unexpected provider path ${route}`);
}

function removeDeployment(world, id) {
  const fault = world.removeFault[id];
  if (fault === 'throw-before') throw new Error(`403 for ${SECRET}`);
  if (fault === 'skip') return;
  const bound = world.aliases.some((entry) => entry.deploymentId === id);
  if (bound) return;
  world.deployments = world.deployments.filter((deployment) => deployment.uid !== id);
  if (fault === 'throw-after') throw new Error('timeout');
}

function mutate(world, args) {
  world.writes.push(args.join(' '));
  world.hooks.onWrite?.(world, args);
  if (args[0] === 'alias') {
    if (world.removeFault[args[2]] === 'alias-fail') throw new Error('alias failure');
    world.aliases = world.aliases.filter((entry) => entry.alias !== args[2]);
    return '';
  }
  removeDeployment(world, args[1]);
  return '';
}

function git(world, args) {
  world.calls.push(`git ${args[0]}`);
  const reads = world.calls.filter((call) => call === 'git ls-remote').length;
  if (args[0] === 'ls-remote' && args[1] === 'origin') {
    const main = typeof world.main === 'function' ? world.main(reads) : world.main;
    return `${main}\trefs/heads/main\n`;
  }
  if (args[0] === 'ls-remote')
    return [...world.branches].map((b) => `${sha(1)}\trefs/heads/${b}`).join('\n');
  if (args[0] === 'status') return world.dirty;
  if (args[0] === 'diff' && world.differs) throw new Error('differs');
  if (args[0] === 'show') return JSON.stringify(world.package);
  return '';
}

function gh(world, args) {
  world.calls.push(`gh ${args[0]}`);
  world.hooks.onRead?.(world, args);
  if (args[0] === 'run') return JSON.stringify(world.runs);
  return JSON.stringify(world.prs);
}

export function makeDeps(world) {
  return {
    git: (args) => git(world, args),
    gh: (args) => gh(world, args),
    vercel(args) {
      world.calls.push(`vercel ${args[0]}`);
      if (args[0] !== 'api') return mutate(world, args);
      if (world.endless && args[1].startsWith('/v6/deployments')) {
        return JSON.stringify({ deployments: [], pagination: { next: 1 } });
      }
      if (world.hooks.failReads) throw new Error(SECRET);
      return JSON.stringify(readApi(world, args[1]));
    },
    http: () => world.http,
    packageJson: () => JSON.stringify(world.package),
    sleep: async () => {},
  };
}
