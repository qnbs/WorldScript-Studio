# TODO — verify the PDF-iframe `sandbox` hardening (DeepSource JS-D010)

> **Status: applied, NOT yet locally verified.** Created 2026-06-24. Owner: maintainer (local check).

## What changed

Added `sandbox="allow-same-origin"` to the two `<iframe>`s that embed **user-imported PDFs** via
`blob:` URLs (resolves DeepSource **JS-D010** "missing sandbox in iframe"):

- `components/ManuscriptResearchSplit.tsx` (Research split — PDF preview)
- `components/BinderPanel.tsx` (Binder — PDF preview)

`allow-same-origin` is required so the `blob:` PDF still loads in the browser's **native** PDF viewer;
**no `allow-scripts`** → embedded JS / forms / top-navigation in a malicious PDF stay blocked. Threat
model is low (the PDF is the user's own local import and the browser PDF viewer is itself sandboxed),
so this is defense-in-depth — but it's a real hardening and DeepSource flags its absence.

## ⚠️ Manual verification needed (do locally before relying on it)

`pnpm run dev` → import a PDF, then in **both** surfaces confirm the PDF still **renders** (not blank /
not forced-download):

1. **Research split** (Manuscript → research panel) — open a PDF node.
2. **Binder panel** — open a PDF node.

Test in **Chrome/Edge** (Chromium PDFium), **Firefox** (pdf.js), and **Safari** if available — the
sandboxed-iframe PDF behaviour differs per engine.

## Iterative refinement (only if verification fails)

- **Renders but download/print button dead** → add `allow-downloads` (and/or `allow-popups` for in-PDF
  links): `sandbox="allow-same-origin allow-downloads allow-popups"`.
- **Blank in Chrome** (PDFium-in-sandbox quirk) → try adding `allow-downloads`; if still blank,
  consider an explicit object/embed fallback or a "open in new tab" affordance. **Do NOT** add
  `allow-scripts` together with `allow-same-origin` — that combination defeats the sandbox and
  DeepSource will (correctly) re-flag it.
- **If no safe value renders on a target engine** → document the accepted residual risk here (user's
  own local PDF, viewer self-sandboxed) and consider a per-engine `sandbox` value.

## Done-when

PDF preview renders in all target browsers with the most restrictive `sandbox` value that works, the
final value recorded here, and this file deleted (or marked ✅ resolved).
