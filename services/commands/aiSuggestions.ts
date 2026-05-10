import type { CommandRuntimeDeps } from './commandTypes';

export interface CommandSuggestion {
  id: string;
  reasonKey: string;
}

/** Lokale, deterministische Vorschläge ohne Netzwerk (max. 3). */
export function getLocalAiSuggestions(deps: CommandRuntimeDeps): CommandSuggestion[] {
  const out: CommandSuggestion[] = [];

  if (deps.currentView === 'dashboard') {
    out.push({ id: 'nav-manuscript', reasonKey: 'palette.suggestion.fromDashboard' });
  }

  if (deps.wordCountApprox < 400 && deps.wordCountApprox >= 0) {
    out.push({ id: 'nav-writer', reasonKey: 'palette.suggestion.lowWordCount' });
  }

  if (deps.currentView === 'manuscript' && deps.wordCountApprox > 5000) {
    out.push({ id: 'ai-consistency', reasonKey: 'palette.suggestion.longDraft' });
  }

  const seen = new Set<string>();
  return out
    .filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    })
    .slice(0, 3);
}
