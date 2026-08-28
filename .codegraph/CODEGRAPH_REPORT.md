# CodeGraph Report

Report schema: 1
Source fingerprint: sha256:c1d44a4509f3611922df3cddfddb56e85f81833b39170388a44599cace03287d
Tool: codegraph
Tool version: 1.6.0
Generation mode: local-index (codegraph status/files)

## Status

```
CodeGraph Status

Project: .

Index Statistics:
  Files:     1.405
  Nodes:     14.847
  Edges:     54.509
  DB Size:   69.30 MB
  Backend:   node:sqlite — built-in (full WAL)
  Journal:   wal

Nodes by Kind:
  import          5.332
  function        2.808
  constant        2.478
  file            1.384
  method          766
  interface       675
  property        487
  type_alias      365
  variable        308
  class           125
  component       48
  enum_member     39
  struct          21
  enum            10
  trait           1

Files by Language:
  typescript      914
  tsx             378
  javascript      68
  rust            21
  yaml            21
  python          2
  xml             1

✓ Index is up to date
```

## Files by Extension

- **.ts**: 898
- **.tsx**: 378
- **.mjs**: 62
- **.rs**: 21
- **.yml**: 18
- **.mts**: 16
- **.js**: 4
- **.yaml**: 3
- **.cjs**: 2
- **.py**: 2
- **.xml**: 1

---

*Regenerate with: `pnpm run graphs:report` (or `pnpm run codegraph:report` directly). Freshness
check: `pnpm run graphs:status`. Package: worldscript-studio.*
