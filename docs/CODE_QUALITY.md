# Code Quality Guide

**Status:** Living document — last updated 2026-06-12 (PR #114 security-hardening follow-up)

This guide documents the conventions, tooling, and policies that keep WorldScript Studio's TypeScript/React codebase maintainable, secure, and accessible. It complements [`CONTRIBUTING.md`](../.github/CONTRIBUTING.md) and [`AUDIT.md`](../.github/CI-AUDIT.md).

---

## Toolchain

| Concern | Tool | Local command |
|---------|------|---------------|
| Lint + Format | Biome | `pnpm run lint` |
| Auto-fix format/lint | Biome | `pnpm run lint:fix` |
| Type checking | TypeScript Go port (`tsgo`) | `pnpm run typecheck` |
| i18n key parity | Custom scripts | `pnpm run i18n:check` |
| Unit tests | Vitest | `pnpm exec vitest run` |
| Suppression-debt ratchet | `scripts/check-suppressions.mjs` | `node scripts/check-suppressions.mjs` |

---

## Suppression Policy (`biome-ignore`)

Our CI enforces a **suppression-debt ratchet**: the total number of `biome-ignore` directives across the TypeScript tree must never exceed the committed baseline in [`suppressions-baseline.json`](../suppressions-baseline.json). See [`scripts/check-suppressions.mjs`](../scripts/check-suppressions.mjs).

### Rules for adding a suppression

1. **Prefer fixing the root cause.** Refactor, add types, or simplify code before adding a suppression.
2. **If a suppression is unavoidable, it must be:**
   - **Specific:** name the exact rule, e.g. `// biome-ignore lint/security/noDangerouslySetInnerHtml: ...`
   - **Justified:** include a concise reason covering security, correctness, or maintainability impact.
   - **Local:** place the comment directly above the line it applies to (avoid broad `biome-ignore-start` ranges).
3. **Never** add a generic suppression such as `// biome-ignore lint` or `// biome-ignore format`.
4. **Security-critical code** (`services/proForge/`, `services/copilot/`, `services/pluginRegistry.ts`, `services/storage/`, `services/ai/`) should avoid suppressions whenever possible — these paths are high-value targets for injection and sandbox-escape bugs.

### Good example

```ts
// biome-ignore lint/security/noDangerouslySetInnerHtml: content is sanitized by DOMPurify with an explicit allowlist before insertion.
ref.current.innerHTML = DOMPurify.sanitize(html, { ALLOWED_TAGS: ['p', 'strong'] });
```

### Bad example

```ts
// biome-ignore: DOMPurify handles it
ref.current.innerHTML = DOMPurify.sanitize(html);
```

### Tracking & removal

- When you add a suppression, consider opening a follow-up issue to remove it later.
- When you refactor code that allows removing a suppression, remove it and run `node scripts/check-suppressions.mjs --update` to ratchet the baseline down.
- The CI gate prints a per-rule breakdown; use `node scripts/check-suppressions.mjs --details` for a per-file breakdown.

---

## Security-sensitive coding patterns

### Input validation for AI-generated content

Any text that AI providers propose for insertion into manuscript, chat, or storage must pass through validation that rejects:

- Null bytes (`\0`).
- C0 control characters except tab, line feed, and carriage return.
- Lone UTF-16 surrogates.
- Excessive length (memory DoS).

Example: [`services/proForge/applyReviewEdits.ts:containsDisallowedControlChar`](../services/proForge/applyReviewEdits.ts).

### Plugin sandboxing

- Plugins never receive raw Redux dispatch.
- All storage keys must be prefixed with `plugin:${pluginId}:` and validated for length, allowed characters, and traversal patterns (`..`).
- Storage values are size-limited.

See [`services/pluginRegistry.ts`](../services/pluginRegistry.ts).

### Rendering untrusted content

- Never use `dangerouslySetInnerHTML` or raw `innerHTML` without prior allowlist-based sanitization (DOMPurify).
- Keep DOMPurify allowlists minimal; avoid `span`, `style`, and event-handler attributes.

---

## CI quality gates

The `Quality Gate` job runs on Node 22 and Node 24 and includes:

1. `pnpm run lint` — Biome lint + format (error on warnings).
2. `pnpm run typecheck` — TypeScript strict check.
3. `pnpm run i18n:check` — Locale parity and bundle rebuild.
4. Suppression-debt ratchet — ensures `biome-ignore` count does not grow.
5. Vitest unit tests with coverage thresholds.

A failure in any of these blocks downstream jobs (Build, E2E, Storybook, Lighthouse, VRT, Deploy).

---

## Recommended local workflow before pushing

```bash
pnpm run lint
pnpm run typecheck
pnpm run i18n:check
node scripts/check-suppressions.mjs
pnpm exec vitest run <relevant-test-files>
```

For low-end hardware, the quick tier is `pnpm run lint && pnpm run typecheck && pnpm run i18n:check`.
