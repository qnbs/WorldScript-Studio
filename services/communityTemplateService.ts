/**
 * Community Template Service
 * Loads community templates from the bundled static asset.
 *
 * Template definitions live in /public/community-templates/index.json
 * and are served at ${BASE_URL}community-templates/index.json — no
 * third-party requests, works offline and with Tauri desktop builds.
 */

import { z } from 'zod';

import type { CommunityTemplate } from '../types';

const INDEX_URL = `${import.meta.env.BASE_URL}community-templates/index.json`;

// QNBS-v3: Zod an der Asset-Grenze — kaputte JSON-Lieferungen fallen auf eingebettete Fallbacks zurück statt still UI zu brüchen.
const communityTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string(),
  type: z.enum(['Genre', 'Structure']),
  author: z.string(),
  tags: z.array(z.string()).min(1),
  arcDescription: z.string(),
  stars: z.number().nonnegative().optional(),
  sections: z.array(z.object({ title: z.string(), description: z.string().optional() })).min(1),
});

const communityTemplatesSchema = z.array(communityTemplateSchema).min(1);

// In-memory cache (valid for the duration of the session)
let cachedTemplates: CommunityTemplate[] | null = null;

export interface CommunityTemplateResult {
  templates: CommunityTemplate[];
  error?: string;
  isFallback?: boolean;
}

/**
 * Fetch the community template index from the bundled static asset.
 * Falls back to embedded templates on network/fetch errors.
 */
export async function fetchCommunityTemplates(
  signal?: AbortSignal,
): Promise<CommunityTemplateResult> {
  if (cachedTemplates) return { templates: cachedTemplates };

  try {
    const res = await fetch(INDEX_URL, {
      signal: signal ?? null,
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      return {
        templates: getFallbackTemplates(),
        error: `Failed to load community templates: HTTP ${res.status}`,
      };
    }

    const raw: unknown = await res.json();
    const parsed = communityTemplatesSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        templates: getFallbackTemplates(),
        error: 'Community templates failed validation',
        isFallback: true,
      };
    }
    const data = parsed.data as CommunityTemplate[];
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
// Displayed when the bundled asset cannot be fetched (e.g. offline / first load).

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
      description:
        'Gothic love story with suspense and dark secrets. Contains mature themes — use only if it fits your story and audience.',
      type: 'Genre',
      author: 'NightWriter42',
      tags: ['Romance', 'Gothic', 'Mystery', 'Dark'],
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
    {
      id: 'community-scifi-first-contact',
      name: 'First Contact Sci-Fi',
      description:
        'Humanity meets intelligent life for the first time — ideas-first science fiction.',
      type: 'Genre',
      author: 'StargazerX',
      tags: ['Sci-Fi', 'First Contact', 'Philosophy'],
      arcDescription:
        'What does it mean to be human — when you must explain it to someone utterly unlike you?',
      stars: 25,
      sections: [
        { title: 'The Signal' },
        { title: 'Global Response' },
        { title: 'The First Message' },
        { title: 'Diplomatic Crisis' },
        { title: 'Misunderstanding and Escalation' },
        { title: 'The Breakthrough' },
        { title: 'True Intentions' },
        { title: 'Decision for Humanity' },
        { title: 'Aftermath — A Changed World' },
      ],
    },
    {
      id: 'community-bildungsroman',
      name: 'Coming-of-Age Arc',
      description: 'A literary bildungsroman — innocence, failure, love, and mature selfhood.',
      type: 'Structure',
      author: 'LitProfessor',
      tags: ['Literary', 'Coming of Age', 'Growth'],
      arcDescription: 'From youthful naivety to adult identity — through failure, love, and loss.',
      stars: 22,
      sections: [
        { title: 'Childhood and Innocence' },
        { title: 'First Confrontation with the World' },
        { title: 'Mentor and Guide' },
        { title: 'First Love / First Defeat' },
        { title: 'Identity Crisis' },
        { title: 'Rebellion and Consequences' },
        { title: 'Rock Bottom' },
        { title: 'Reconciliation with the Past' },
        { title: 'Coming-of-Age Trial' },
        { title: 'Setting Out into the Future' },
      ],
    },
  ];
}
