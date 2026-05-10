import { normalizeSearch } from '../commands/fuzzyScore';

export interface HelpDocChunk {
  id: string;
  title: string;
  body: string;
}

/** Statische Hilfe-Auszüge (lokal, offline) — „poor man's RAG“. */
const HELP_DOC_CHUNKS: HelpDocChunk[] = [
  {
    id: 'palette',
    title: 'Command palette',
    body: 'Open the command palette with Ctrl+K or Cmd+K. Search any view, run AI shortcuts, pin favorites with right-click, and switch theme or language.',
  },
  {
    id: 'manuscript',
    title: 'Manuscript editor',
    body: 'The three-panel manuscript editor combines outline, writing canvas, and inspector. Sections sync with the Scene Board and exports.',
  },
  {
    id: 'snapshots',
    title: 'Snapshots & backups',
    body: 'Snapshots capture manuscript checkpoints. Configure automatic backups under Settings → Backup and restore from Settings → Data.',
  },
  {
    id: 'ai-studio',
    title: 'AI Writing Studio',
    body: 'AI tools live under Writer and related views. Provider keys are stored locally; choose Gemini, OpenAI, Anthropic, Grok, or local Ollama.',
  },
];

function scoreChunk(queryNorm: string, chunk: HelpDocChunk): number {
  const hay = `${chunk.title} ${chunk.body}`;
  const h = normalizeSearch(hay);
  if (!queryNorm || !h.includes(queryNorm)) {
    if (!queryNorm) return 1;
    let qi = 0;
    for (let i = 0; i < h.length && qi < queryNorm.length; i++) {
      if (h[i] === queryNorm[qi]) qi++;
    }
    return qi >= queryNorm.length ? 5 : 0;
  }
  return 10 + queryNorm.length;
}

export function retrieveHelpDocContext(question: string, maxChars = 2800): string {
  const qn = normalizeSearch(question);
  const ranked = HELP_DOC_CHUNKS.map((c) => ({ c, s: scoreChunk(qn, c) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 6);

  const picked = ranked.length ? ranked : HELP_DOC_CHUNKS.slice(0, 3).map((c) => ({ c, s: 1 }));

  let out = '';
  for (const { c } of picked) {
    const block = `## ${c.title}\n${c.body}\n\n`;
    if (out.length + block.length > maxChars) break;
    out += block;
  }
  return out.trim();
}

export function retrieveHelpDocSources(question: string): string[] {
  const qn = normalizeSearch(question);
  return HELP_DOC_CHUNKS.map((c) => ({ c, s: scoreChunk(qn, c) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 4)
    .map((x) => x.c.title);
}
