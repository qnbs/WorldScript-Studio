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
    body: 'The three-panel manuscript editor combines outline, writing canvas, and inspector. Sections sync with the Scene Board and exports. Use @ for characters and # for worlds.',
  },
  {
    id: 'writer',
    title: 'AI Writing Studio',
    body: 'Writer view: select section, pick AI tool, enable RAG context, generate into scratchpad, insert or replace. Hybrid fallback retries providers from Settings.',
  },
  {
    id: 'plot-board',
    title: 'Plot Board / Scene Board',
    body: 'Canvas mode with pan, zoom, pinch, minimap, SVG connections (44px touch targets). Swimlanes and timeline modes. AI suggest next beat.',
  },
  {
    id: 'snapshots',
    title: 'Snapshots & backups',
    body: 'Snapshots capture manuscript checkpoints. Dashboard backup card: JSON export/import. Settings → Backup for schedules; Settings → Data for restore and encrypted library.',
  },
  {
    id: 'rag-context',
    title: 'RAG context (local retrieval)',
    body: 'Enable RAG in Writer. Rebuild hybrid index under Settings → Advanced AI. Scoring: semantic + lexical + recency. DuckDB 384-dim when enableDuckDbAnalytics is on.',
  },
  {
    id: 'feature-flags',
    title: 'Feature flags',
    body: 'Twelve flags under Settings → Experimental: codex, story bible, binder, compile wizard, health score, cross-project search, app health, plot board v2, DuckDB, objects, mind maps, interviews.',
  },
  {
    id: 'settings-guide',
    title: 'Settings guide',
    body: 'Settings → Settings guide lists every category with jump links. Search box filters sidebar. Categories: AI, accessibility, backup, data, shortcuts, experimental flags.',
  },
  {
    id: 'documentation',
    title: 'Technical documentation',
    body: 'Help → Technical Documentation: architecture, data model, RAG pipeline, DuckDB analytics, lazy loading, PWA/Tauri, deployment, privacy.',
  },
  {
    id: 'characters-worlds',
    title: 'Characters & worlds',
    body: 'Character dossiers with AI generation and portraits. World atlas with timelines and locations. Character graph visualizes relationships.',
  },
  {
    id: 'export',
    title: 'Export',
    body: 'Export view: Markdown, TXT, PDF with typography options. Optional AI synopsis. Compile wizard when enableCompileWizard flag is on.',
  },
  {
    id: 'desktop',
    title: 'Desktop app (Tauri)',
    body: 'Tauri desktop: Ollama localhost, open data folder, optional updater in About. Window state and native menu on supported builds.',
  },
  {
    id: 'analysis',
    title: 'Analysis tools',
    body: 'Consistency checker, AI Critic, project health on dashboard, cross-project search, progress tracker, book preview.',
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
    .slice(0, 8);

  const picked = ranked.length ? ranked : HELP_DOC_CHUNKS.slice(0, 4).map((c) => ({ c, s: 1 }));

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
    .slice(0, 5)
    .map((x) => x.c.title);
}
