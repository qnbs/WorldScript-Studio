# Git and GitHub access reliability

Status: diagnosed on 2026-08-23 during H0 integration closure.

This record separates repository state from execution-environment state. It contains no
credentials, tokens, or private signing material.

## Root cause

The previous H0 session ran inside a restricted Codex sandbox that exposed the working tree as
writable but bind-mounted the repository's `.git` path read-only. The same sandbox also blocked or
distorted access to the host keyring and external DNS/API networking. That produced three different
symptoms which were incorrectly encountered as one intermittent failure:

| Layer | Restricted sandbox symptom | Authorized context result | Classification |
| --- | --- | --- | --- |
| Working tree / `.git` mount | `.git` write probe and ref creation failed with read-only filesystem | Narrow probes succeeded; root and `.git` are `rw` | Execution-environment mount policy |
| Git transport / DNS | `git ls-remote origin HEAD` failed: `Could not resolve host: github.com` | HTTPS Git read succeeded | Execution-environment network policy |
| GitHub CLI auth/API | `gh auth status` reported the stored account token invalid; API read failed to connect | Keyring-backed auth is valid; `gh repo view` succeeded | Execution-environment keyring/network access |

The authorized context showed `/home/pc/WorldScript-Studio` and `.git` owned by `pc:pc`, with no
stale lock files. It also showed the expected `ext4` filesystem mounted read/write. Therefore there
is no evidence for ownership drift, bad permission bits, a stale lock, dubious repository ownership,
or repository corruption. No `chmod`, `chown`, `safe.directory`, lock deletion, remote rewrite, or
global Git configuration change is warranted.

## Diagnostic matrix

| Layer | Evidence | Root cause / disposition |
| --- | --- | --- |
| A. Working-tree write | Authorized temporary file probe succeeded; normal edits were already possible | Healthy in authorized context |
| B. `.git` write | Restricted probe failed with read-only filesystem; authorized probe succeeded | Sandbox mount policy; no repository fix |
| C. Ownership / `safe.directory` | Active UID/GID and repository paths are `1000:1000` / `pc:pc`; Git status does not report dubious ownership | No ownership repair; no wildcard safe-directory entry |
| D. Index/ref locking | No `*.lock` files; `git update-index --refresh` reached normal “needs update” output for the intentionally modified files | No stale lock; the nonzero refresh result reflects unstaged H0 edits |
| E. Linked worktrees | Main, `incident-332`, and `scenario-465` registrations all point to existing paths | Healthy; preserved project `.worktrees/` was not pruned |
| F. Hooks | Default `.git/hooks`; `pre-commit` and `pre-push` are executable and owned by `pc:pc` | Healthy |
| G. Signing | `pnpm run signing:doctor` passed; SSH signing, configured key, allowed signers, hooks, and isolated probe all passed | Healthy; no signing bypass |
| H. Git transport | HTTPS `git ls-remote origin HEAD` succeeds in authorized context; SSH probe fails with public-key denial | Keep HTTPS; SSH is not the configured auth path |
| I. GitHub CLI auth | Authorized `gh auth status` reports active `qnbs` account, keyring-backed auth, and `gist`, `read:org`, `repo`, `workflow` scopes | Healthy only in authorized context |
| J. GitHub API/network | Authorized DNS, HTTPS, `gh repo view`, and GitHub API reads succeed | Restricted sandbox network/keyring policy |
| K. Runtime/container mount | `findmnt` in restricted context showed working tree `rw` but `.git` `ro`; authorized context showed root `rw` | Primary root cause |
| L. UID/GID drift | No mismatch found | Not causal |

## Safe operating rule

Before any PR-producing stage, run the following preflight in the intended authorized execution
context:

```text
git rev-parse --git-common-dir
git status --short --branch
git ls-remote origin HEAD
gh auth status
gh repo view qnbs/WorldScript-Studio --json nameWithOwner,defaultBranchRef
pnpm run signing:doctor
```

The first PR-producing command must also perform the following narrow temporary write probe in the
working tree and Git common directory. Run it before branch creation; `set -euo pipefail` makes any
failed creation or validation stop the shell before a branch can be created. The probe does not
touch refs, the index, or config, and cleanup removes only the two exact uniquely named files:

```bash
set -euo pipefail
repo_root="$(git rev-parse --show-toplevel)"
git_common="$(git rev-parse --path-format=absolute --git-common-dir)"

work_probe="$repo_root/.wss-git-write-probe.$$"
git_probe="$git_common/.wss-git-write-probe.$$"

cleanup_probes() {
  rm -f -- "$work_probe" "$git_probe"
}
trap cleanup_probes EXIT INT TERM

umask 077
: > "$work_probe"
: > "$git_probe"

test -f "$work_probe"
test -f "$git_probe"

rm -f -- "$work_probe" "$git_probe"
trap - EXIT INT TERM
```

Keep the remote, auth, and signing probes below after this write probe. If `.git` is read-only or
GitHub DNS/keyring access is unavailable, stop before branch creation and resume in an authorized
writable context. Preserve the working-tree H0 files; do not repair the condition with `sudo git`,
broad ownership changes, unsafe `safe.directory` wildcards, token-bearing URLs, hook bypasses, or
force pushes.

## Repeated verification

A single successful push is not sufficient to close this incident. H0 records three consecutive
successful non-destructive probes for Git status, local HEAD, GitHub remote HEAD, and an
authenticated GitHub repository read in the authorized context. Signing doctor is run before
branch creation and again as part of the PR-producing preflight. The exact attempt results belong
in the H0 program ledger.

| Attempt | Local HEAD | Remote HEAD | GitHub API read | Signing doctor | Duration |
| --- | --- | --- | --- | --- | ---: |
| 1 | `2d63a91d…` | `2d63a91d…` | passed | passed | 10s |
| 2 | `2d63a91d…` | `2d63a91d…` | passed | passed | 9s |
| 3 | `2d63a91d…` | `2d63a91d…` | passed | passed | 10s |

Probe result: exit 0. The restricted sandbox remains unqualified; these results apply to the
authorized execution context used for PR-producing work.

## Scope and residual risk

`ROOT CAUSE = execution environment / mount, keyring, and network policy`.

`REPOSITORY FIX = none required`.

`OPERATING RULE = detect an authorized writable Git/GitHub context before PR-producing work`.

The restricted sandbox may remain unable to create refs, access the host keyring, or resolve
GitHub. That is an environment capability boundary, not evidence that the repository is fixed for
all environments. A future session must re-run this preflight rather than infer reliability from a
previous session.
