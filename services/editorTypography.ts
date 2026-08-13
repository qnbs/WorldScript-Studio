/**
 * Single source of truth for the manuscript/writer editor font stacks.
 * QNBS-v3 (#341): components/ui/Textarea.tsx, components/writing/ContextPanel.tsx, and
 * components/manuscript/ManuscriptEditor.tsx each maintained their own copy of this mapping —
 * ContextPanel.tsx's copy had drifted to generic CSS keywords instead of concrete font stacks,
 * producing different glyph metrics between its real (invisible) textarea and its visible text
 * mirror, which is what made selection position drift from the visible caret/highlight.
 */

import type { EditorFont } from '../types';

export const EDITOR_FONT_STACKS: Record<EditorFont, string> = {
  serif: 'Merriweather, serif',
  'sans-serif': 'Inter, sans-serif',
  monospace: 'JetBrains Mono, monospace',
  custom: 'JetBrains Mono, monospace',
};

/**
 * Resolves the concrete font-family stack for an editor surface. RTL prose needs Noto glyph
 * coverage (generic serif/sans/mono stacks lack reliable Arabic/Hebrew rendering) — this mirrors
 * the RTL branch ManuscriptEditor.tsx already had before this module existed.
 */
// QNBS-v3 (#341/#344): customFontName is quoted and prepended ahead of the 'custom' stack's JetBrains Mono fallback — previously ignored entirely, so every 'custom' editorFont silently rendered as monospace.
export function resolveEditorFontFamily(
  editorFont: EditorFont,
  dir: 'ltr' | 'rtl' = 'ltr',
  customFontName?: string,
): string {
  const ltrStack =
    editorFont === 'custom' && customFontName
      ? `"${customFontName}", ${EDITOR_FONT_STACKS.custom}`
      : (EDITOR_FONT_STACKS[editorFont] ?? EDITOR_FONT_STACKS['sans-serif']);
  if (dir !== 'rtl') return ltrStack;
  return editorFont === 'sans-serif' || editorFont === 'monospace'
    ? `"Noto Sans Arabic", "Noto Sans Hebrew", ${ltrStack}`
    : `"Noto Naskh Arabic", "Noto Sans Hebrew", ${ltrStack}`;
}
