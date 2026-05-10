import type { AiCreativity } from '../../types';

/** Gleiche Abbildung wie in `geminiService.ts` — Writer-Pfad nutzt Kreativität statt Roh-Temperatur. */
export const CREATIVITY_TO_TEMPERATURE: Record<AiCreativity, number> = {
  Focused: 0.2,
  Balanced: 0.7,
  Imaginative: 1.0,
};
