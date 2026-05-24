# CodeGraph Report

**Generated:** 2026-05-24T13:34:00+02:00
**Project:** StoryCraft Studio
**Version:** 0.9.3

## Status

```
CodeGraph Status
Project: /home/pc/StoryCraft-Studio

Index Statistics:
  Files:     260
  Nodes:     2.754
  Edges:     2.443
  DB Size:   4.81 MB
  Backend:   node:sqlite — built-in (full WAL)
  Journal:   wal

Nodes by Kind:
  import          1.381
  function        514
  constant        409
  file            247
  interface       111
  type_alias      51
  method          32
  variable        6
  class           3

Files by Language:
  tsx             125
  typescript      107
  javascript      14
  yaml            14

✓ Index is up to date
```

## Files by Language

- **TypeScript (.ts)**: 107 files
- **TSX (.tsx)**: 125 files
- **JavaScript (.js)**: 14 files
- **YAML (.yml/.yaml)**: 14 files

## Notes

- Index respects `.gitignore` — `node_modules/`, `dist/`, `src-tauri/target/`, `graphify-out/` excluded
- WAL mode enabled — concurrent reads never block writes
- Auto-sync active via MCP server file watcher (2s debounce)

---

*Regenerate with: `pnpm run codegraph:report` or `codegraph status > .codegraph/CODEGRAPH_REPORT.md`*
