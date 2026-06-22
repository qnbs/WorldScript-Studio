// QNBS-v3: PR5 — type declarations for the parts of the README build script imported by the drift
// guard test (tests/unit/help/readmeDrift.test.ts). The script itself stays plain JS (.mjs).

/** Curate README.md → clean, app-appropriate markdown (strips badges/TOC/German section, abs links). */
export function curate(md: string): string;

/** Render curated markdown → the self-contained HTML fragment written to public/readme/<lang>.html. */
export function renderHtml(md: string, lang: string): string;
