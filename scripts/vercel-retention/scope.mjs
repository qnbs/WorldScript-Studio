// QNBS-v3: the provider scope is a constant, never an argument, so a broad credential cannot widen what this runner enumerates or deletes.
export const SCOPE = Object.freeze({
  team: 'qnbs-projects',
  teamId: 'team_Dx4T2J41LNqP8mDgrRraonWp',
  project: 'worldscript-studio',
  projectId: 'prj_XJDiKIlKNg5sbmw6xMHIlf6glXHy',
  org: 'qnbs',
  repo: 'WorldScript-Studio',
  repository: 'qnbs/WorldScript-Studio',
});

export const CANONICAL_ALIASES = Object.freeze([
  'worldscript-studio.vercel.app',
  'worldscript-studio-qnbs-projects.vercel.app',
  'worldscript-studio-git-main-qnbs-projects.vercel.app',
]);

export const CANONICAL_URL = 'https://worldscript-studio.vercel.app/';
export const REQUIRED_RUNS = Object.freeze(['CI / CD', 'CodeQL SAST']);
export const TERMINAL_STATES = new Set(['READY', 'ERROR', 'CANCELED']);
export const MAX_DELETIONS = 25;
export const PAUSE_MS = 1500;
