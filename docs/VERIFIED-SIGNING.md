# Verified signing policy

WorldScript Studio requires signed commit objects at the local hook boundary and requires
GitHub's `commit.verification.verified == true` result at the CI boundary. These are related
but different checks:

- `git verify-commit` proves that the local Git installation can validate the signature object
  against its configured trust/key policy. It does not prove that GitHub will associate the
  commit with a verified account.
- GitHub's `verification.verified` result is the release and merge gate. It covers GitHub's
  signature parser, key association, and account identity rules.
- Annotated release tags have two objects to verify: the tag object and its target commit.
  Lightweight release tags are rejected because they have no independently verifiable tag
  object; a verified target commit alone is insufficient for a release tag.

## Local setup and recovery

Run `pnpm run signing:doctor` after configuring a signing key. The doctor performs a
plumbing-level `git commit-tree -S` probe in an isolated temporary repository and validates the
result with Git-native verification. It never invokes normal repository hooks, reads private key
material, or prints signatures. `pnpm run hooks:install` installs the fail-closed pre-commit and
pre-push wrappers.

If a hook rejects a commit or push:

1. Run the doctor and correct the reported effective configuration, identity, key availability,
   or trust/allowed-signers configuration.
2. Re-run the exact failed operation. Never use `--no-gpg-sign`, `--no-verify`, an unsigned
   temporary commit, or an unsigned tag as a recovery path.
3. Use `pnpm run signing:check-range -- before..after` to inspect an exact local range.
4. For a pull request, use `pnpm run signing:verify-remote -- <owner>/<repo> <number>` when a
   GitHub token is available; the CI gate remains authoritative.

The hook reads effective Git configuration, including repository and worktree configuration.
Repository-local and worktree-local values override global values, and environment-provided Git
configuration can override all of them. The doctor reports unsafe configuration overrides rather
than silently accepting them. Configure only a public signing-key reference where possible;
never copy, print, commit, or place private key material in the repository.

## History and squash semantics

The signing cutover applies to every new commit, push, release tag, and GitHub merge result. It
does not rewrite legacy history. A squash merge creates a new signed commit whose tree contains
the reviewed change; it does not make the unsigned source commits in the old branch signed or
erase their historical verification state. A historical audit is evidence for migration planning,
not a release waiver for new unsigned objects.

CI verifies the complete `before..after` range for branch pushes and the complete paginated PR
commit list for pull requests. Public-fork pull requests use read-only GitHub API access. API
errors, missing pages, missing verification data, invalid signatures, unsigned commits, and
unverified tag objects fail closed.

## Historical audit snapshot

The audit below is generated against `main` with GitHub's verification result, not merely local
Git trust. Dates are UTC and the interval is inclusive of commits reachable from `main` whose
committer timestamp is within the stated trailing window. Keep the command output or API response
with the release evidence when refreshing these figures.

| Window ending 2026-08-23 UTC | Verified | Unverified | Total |
| --- | ---: | ---: | ---: |
| 7 days | 89 | 0 | 89 |
| 14 days | 124 | 0 | 124 |
| 30 days | 178 | 0 | 178 |

This snapshot intentionally distinguishes the signed squash result from the source history that
preceded it. Open and merged PR source histories should be audited separately when investigating
legacy unsigned commits. The counts were collected on 2026-08-23 with GitHub's REST commits API,
`sha=main`, at collection time `2026-08-23T00:15:24Z`, with cutoff
`2026-08-23T00:15:24Z` and trailing UTC windows, using the `commit.verification.verified`
boolean; they are not inferred from local Git trust.
