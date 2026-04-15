/**
 * Community Template Service
 * Fetches public templates from the GitHub repository.
 *
 * Template definitions live in /community-templates/index.json
 * in the main branch of qnbs/StoryCraft-Studio.
 */

import type { CommunityTemplate } from '../types';

const GITHUB_RAW_BASE =
  'https://raw.githubusercontent.com/qnbs/StoryCraft-Studio/main/community-templates';

const GITHUB_INDEX_URL = `${GITHUB_RAW_BASE}/index.json`;

// In-memory cache (valid for the duration of the session)
let cachedTemplates: CommunityTemplate[] | null = null;

export interface CommunityTemplateResult {
  templates: CommunityTemplate[];
  error?: string;
  isFallback?: boolean;
}

/**
 * Fetch the community template index from GitHub.
 * Falls back to an empty array on network errors.
 */
export async function fetchCommunityTemplates(
  signal?: AbortSignal
): Promise<CommunityTemplateResult> {
  if (cachedTemplates) return { templates: cachedTemplates };

  try {
    const res = await fetch(GITHUB_INDEX_URL, {
      signal: signal ?? null,
      headers: { Accept: 'application/json' },
      // Avoid stale GitHub CDN cache
      cache: 'no-store',
    });

    if (!res.ok) {
      return {
        templates: getFallbackTemplates(),
        error: `GitHub API: HTTP ${res.status}`,
      };
    }

    const data = (await res.json()) as CommunityTemplate[];
    cachedTemplates = data;
    return { templates: data };
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') {
      return { templates: [] };
    }
    // Network error — use embedded fallbacks so the feature still works offline
    return {
      templates: getFallbackTemplates(),
      error: 'Community Templates konnten nicht geladen werden (offline?)',
      isFallback: true,
    };
  }
}

/** Clear the session cache (e.g., after user presses "Refresh") */
export function clearCommunityTemplateCache(): void {
  cachedTemplates = null;
}

// ─── Fallback Templates (embedded) ───────────────────────────────────────────
// Displayed when GitHub is unreachable.

function getFallbackTemplates(): CommunityTemplate[] {
  return [
    {
      id: 'community-hero-journey',
      name: 'Die Heldenreise (Community)',
      description: 'Campbells klassisches Monomythos-Framework, angepasst für moderne Geschichten.',
      type: 'Structure',
      author: 'Community',
      tags: ['Klassisch', 'Abenteuer', 'Transformation'],
      arcDescription:
        'Der Held verlässt die gewohnte Welt, übersteht Prüfungen und kehrt verändert zurück.',
      stars: 42,
      sections: [
        { title: 'Die gewohnte Welt' },
        { title: 'Der Ruf zum Abenteuer' },
        { title: 'Weigerung des Rufs' },
        { title: 'Begegnung mit dem Mentor' },
        { title: 'Überschreiten der ersten Schwelle' },
        { title: 'Prüfungen, Verbündete und Feinde' },
        { title: 'Am tiefsten Punkt' },
        { title: 'Die entscheidende Prüfung' },
        { title: 'Belohnung' },
        { title: 'Der Rückweg' },
        { title: 'Auferstehung' },
        { title: 'Rückkehr mit dem Elixier' },
      ],
    },
    {
      id: 'community-dark-romantik',
      name: 'Dark Romantik',
      description: 'Gotische Liebesgeschichte mit Spannung und dunklen Geheimnissen.',
      type: 'Genre',
      author: 'NightWriter42',
      tags: ['Romantik', 'Gothic', 'Mystery', '#dark'],
      arcDescription:
        'Verbotene Liebe in einer Welt voller Geheimnisse — Spannung und Leidenschaft im Gleichgewicht.',
      stars: 31,
      sections: [
        { title: 'Erste Begegnung im Dunkeln' },
        { title: 'Das verborgene Geheimnis' },
        { title: 'Anziehung trotz Warnung' },
        { title: 'Das erste Versprechen' },
        { title: 'Entdeckung der wahren Natur' },
        { title: 'Verrat und Trennung' },
        { title: 'Die Entscheidung' },
        { title: 'Opfer und Erlösung' },
      ],
    },
    {
      id: 'community-thriller-countdown',
      name: 'Countdown Thriller',
      description:
        'Hochspannung mit tickender Uhr — Zeitdruck von der ersten bis zur letzten Seite.',
      type: 'Structure',
      author: 'ThrillMaster',
      tags: ['Thriller', 'Action', 'Zeitdruck'],
      arcDescription:
        'Ein Protagonist mit begrenzter Zeit, ein Antagonist der im Verborgenen agiert.',
      stars: 28,
      sections: [
        { title: 'Die Bombe tickt (Setup)' },
        { title: 'Erste Spur' },
        { title: 'Falsche Fährte' },
        { title: 'Eskalation — erste Casualty' },
        { title: 'Wendepunkt: Enthüllung' },
        { title: 'Countdown beschleunigt sich' },
        { title: 'Alles verloren — Heldin allein' },
        { title: 'Finale Konfrontation' },
        { title: 'Auflösung & Aftermath' },
      ],
    },
    {
      id: 'community-cozy-mystery',
      name: 'Cozy Mystery',
      description:
        'Gemütliches Rätsel in einer charmanten Kleinstadt — ohne Blut, aber mit viel Witz.',
      type: 'Genre',
      author: 'TeaAndClues',
      tags: ['Mystery', 'Cozy', 'Humor', 'Kleinstadt'],
      arcDescription:
        'Amateurermittlerin löst Dorfgeheimnisse zwischen Kuchenbäckerei und Klatsch.',
      stars: 19,
      sections: [
        { title: 'Die charmante Kleinstadt' },
        { title: 'Das seltsame Ereignis' },
        { title: 'Verdächtige Dorfbewohner' },
        { title: 'Erste Ermittlungen' },
        { title: 'Roter Hering' },
        { title: 'Persönliche Gefahr' },
        { title: 'Der entscheidende Hinweis' },
        { title: 'Auflösung beim Dorffest' },
      ],
    },
  ];
}
