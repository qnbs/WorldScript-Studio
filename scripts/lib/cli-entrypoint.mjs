import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// QNBS-v3 (live review, PR #817; shared by #447): resolves the canonical repo root from a module URL independent of whether that URL itself is symlink-resolved. isDirectExecution deliberately accepts BOTH the resolved and unresolved comparison (so `node --preserve-symlinks-main` is still recognized as direct execution), but repo-relative authority — root, baseline/report paths, the git subprocess cwd — must always anchor to the real file location: under --preserve-symlinks-main, import.meta.url stays the unresolved symlink path, and a symlink living outside the repository would otherwise compute a root outside it entirely. fs.realpathSync resolves the module path itself first, so this is correct regardless of which of the two import.meta.url forms was actually passed in.
export function resolveModuleRoot(moduleUrl) {
  const modulePath = fs.realpathSync(fileURLToPath(moduleUrl));
  return path.resolve(path.dirname(modulePath), '..');
}

// QNBS-v3 (Sourcery, PR #817): a raw `file://${argv[1]}` string comparison is not portable — argv[1] is an unencoded filesystem path (no URL-encoding of spaces/unicode, no Windows `file:///C:/...` drive-letter form), while import.meta.url always is; pathToFileURL performs that same platform-correct conversion before comparing. Exported so the comparison itself can be regression-tested without spawning the real CLI.
// QNBS-v3 (Codex + live review, PR #817): two legitimate Node semantics both need to match. Normally Node resolves import.meta.url through a symlink to its real target while leaving argv[1] as the invoked symlink path (checked via the realpathSync fallback below); under `node --preserve-symlinks-main`, Node does the opposite and leaves import.meta.url as the unresolved symlink path too (checked by the first, cheap comparison, which also covers the ordinary non-symlinked case). Accepting either means neither mode silently exits 0 without scanning.
export function isDirectExecution(argv1, moduleUrl) {
  if (typeof argv1 !== 'string' || argv1.length === 0) return false;
  if (moduleUrl === pathToFileURL(argv1).href) return true;
  try {
    return moduleUrl === pathToFileURL(fs.realpathSync(argv1)).href;
  } catch {
    // argv1 doesn't exist on disk (e.g. a synthetic test path) — the unresolved comparison above already covers that case.
    return false;
  }
}
