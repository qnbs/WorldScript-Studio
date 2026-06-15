# TypeScript 7 Migration Guide

> **Status**: ✅ Phase 1-3 complete (2026-06-04)

## Overview

WorldScript Studio migrated from TypeScript 6.0.3 to TypeScript 7.0 (Go-based `tsgo`) for improved type-checking performance.

## Architecture

### Dual-Setup Pattern

```
package.json
├── @typescript/native-preview@beta    # TS7 Go compiler (tsgo)
└── @typescript/typescript6           # Compatibility alias for peer deps
```

- **tsgo** (`npx tsgo`) is the primary type-checker for CI and development
- **@typescript/typescript6** provides `typescript` package alias for tools expecting the standard package name (Vite plugins, Stryker, etc.)

### Configuration Files

| File | Purpose |
|------|---------|
| `tsconfig.json` | Standard configuration (used by Vite, IDEs) |
| `tsconfig.tsgo.json` | tsgo-specific config (excludes `vite/client` types) |

## Changes Made

### 1. package.json
```json
{
  "devDependencies": {
    "@typescript/native-preview": "beta",
    "@typescript/typescript6": "npm:typescript@~6.0.3"
  },
  "pnpm": {
    "overrides": {
      "typescript": "npm:@typescript/typescript6@~6.0.3"
    }
  }
}
```

### 2. Scripts
```json
{
  "scripts": {
    "typecheck": "tsgo --project tsconfig.tsgo.json --noEmit",
    "typecheck:parallel": "tsgo --project tsconfig.tsgo.json --noEmit --checkers 4"
  }
}
```

### 3. tsconfig.tsgo.json
- Removed `vite/client` from `types` (tsgo Preview doesn't support it yet)
- All path aliases preserved from main tsconfig

### 4. CI Workflow (.github/workflows/ci.yml)
```yaml
- name: Typecheck (tsgo)
  run: npx tsgo --project tsconfig.tsgo.json --noEmit --checkers 4 --builders 4
```

## Known Limitations

### tsgo Preview (v7.0.0-dev.20260421.2)

1. **vite/client types**: Not supported. Workaround: Use `tsconfig.tsgo.json` without `vite/client` in types array.

2. **npm warnings**: `npx` uses npm which shows deprecation warnings for pnpm-specific config options. These are harmless.

## Performance

Expected improvements with tsgo:
- Parallel type checking with `--checkers N --builders N`
- Native Go performance for large codebases
- Incremental compilation support

## Rollback

To revert to TypeScript 6:
```bash
pnpm remove @typescript/native-preview @typescript/typescript6
pnpm add -D typescript@~6.0.3
```

Then remove `tsconfig.tsgo.json` and revert scripts to use `tsc`.