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
  signal?: AbortSignal,
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
      error: 'Community templates could not be loaded (offline?)',
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
      name: "The Hero's Journey (Community)",
      description: "Campbell's classic monomyth framework, adapted for modern stories.",
      type: 'Structure',
      author: 'Community',
      tags: ['Classic', 'Adventure', 'Transformation'],
      arcDescription:
        'The hero leaves the ordinary world, survives trials, and returns transformed.',
      stars: 42,
      sections: [
        { title: 'The Ordinary World' },
        { title: 'The Call to Adventure' },
        { title: 'Refusal of the Call' },
        { title: 'Meeting the Mentor' },
        { title: 'Crossing the First Threshold' },
        { title: 'Tests, Allies and Enemies' },
        { title: 'The Innermost Cave' },
        { title: 'The Supreme Ordeal' },
        { title: 'Reward' },
        { title: 'The Road Back' },
        { title: 'Resurrection' },
        { title: 'Return with the Elixir' },
      ],
    },
    {
      id: 'community-dark-romantik',
      name: 'Dark Romance',
      description: 'Gothic love story with suspense and dark secrets.',
      type: 'Genre',
      author: 'NightWriter42',
      tags: ['Romance', 'Gothic', 'Mystery', '#dark'],
      arcDescription:
        'Forbidden love in a world full of secrets — suspense and passion in balance.',
      stars: 31,
      sections: [
        { title: 'First Encounter in the Dark' },
        { title: 'The Hidden Secret' },
        { title: 'Attraction Despite Warning' },
        { title: 'The First Promise' },
        { title: 'Discovery of True Nature' },
        { title: 'Betrayal and Separation' },
        { title: 'The Decision' },
        { title: 'Sacrifice and Redemption' },
      ],
    },
    {
      id: 'community-thriller-countdown',
      name: 'Countdown Thriller',
      description: 'High tension with a ticking clock — time pressure from first to last page.',
      type: 'Structure',
      author: 'ThrillMaster',
      tags: ['Thriller', 'Action', 'Time Pressure'],
      arcDescription: 'A protagonist with limited time, an antagonist operating in the shadows.',
      stars: 28,
      sections: [
        { title: 'The Bomb Ticks (Setup)' },
        { title: 'First Lead' },
        { title: 'False Trail' },
        { title: 'Escalation — First Casualty' },
        { title: 'Turning Point: Revelation' },
        { title: 'Countdown Accelerates' },
        { title: 'All Lost — Heroine Alone' },
        { title: 'Final Confrontation' },
        { title: 'Resolution & Aftermath' },
      ],
    },
    {
      id: 'community-cozy-mystery',
      name: 'Cozy Mystery',
      description: 'A cozy puzzle in a charming small town — no blood, but lots of wit.',
      type: 'Genre',
      author: 'TeaAndClues',
      tags: ['Mystery', 'Cozy', 'Humor', 'Small Town'],
      arcDescription: 'An amateur detective solves village mysteries between baking and gossip.',
      stars: 19,
      sections: [
        { title: 'The Charming Small Town' },
        { title: 'The Strange Event' },
        { title: 'Suspicious Villagers' },
        { title: 'First Investigations' },
        { title: 'Red Herring' },
        { title: 'Personal Danger' },
        { title: 'The Crucial Clue' },
        { title: 'Resolution at the Village Festival' },
      ],
    },
  ];
}
