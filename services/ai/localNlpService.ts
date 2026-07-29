// QNBS-v3: [Local NLP service — sentiment/summarization via workers/v2/inference.worker.ts through WorkerBus v2 (docs/adr/0014 migration).]

import { ensureInferencePool } from '../workerBusManager';

export interface SentimentResult {
  label: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  score: number; // 0–1 confidence
  normalized: number; // -1 to +1 (NEGATIVE → -score, POSITIVE → +score)
}

const SENTIMENT_MODEL = 'Xenova/distilbert-base-uncased-finetuned-sst-2-english';
const SUMMARIZATION_MODEL = 'Xenova/distilbart-cnn-6-6';
const MAX_SUMMARY_TOKENS = 150;

async function requestInference(
  task: string,
  modelId: string,
  input: string,
  inferenceOptions?: Record<string, unknown>,
): Promise<string> {
  const bus = await ensureInferencePool();
  if (!bus) throw new Error('WorkerBus v2 unavailable');
  // QNBS-v3: Omit inferenceOptions key (not `: undefined`) — exactOptionalPropertyTypes rejects
  //          an explicit undefined against the optional payload field.
  const payload = {
    task,
    modelId,
    input,
    ...(inferenceOptions !== undefined ? { inferenceOptions } : {}),
  };
  const handle = bus.enqueue<
    { task: string; modelId: string; input: string; inferenceOptions?: Record<string, unknown> },
    string
  >('inference.text', payload, { capabilities: ['inference.text'] });
  return handle.result;
}

export async function analyzeSentiment(text: string): Promise<SentimentResult> {
  const capped = text.slice(0, 512); // model input limit

  try {
    const result = await requestInference('sentiment-analysis', SENTIMENT_MODEL, capped);

    // Worker returns "LABEL:score" string (see workers/v2/inference.worker.ts sentiment branch)
    const [labelRaw, scoreRaw] = result.split(':');
    const rawLabel = (labelRaw ?? 'NEUTRAL').toUpperCase();
    const score = parseFloat(scoreRaw ?? '0.5');

    const label: SentimentResult['label'] =
      rawLabel === 'POSITIVE' ? 'POSITIVE' : rawLabel === 'NEGATIVE' ? 'NEGATIVE' : 'NEUTRAL';

    const normalized = label === 'POSITIVE' ? score : label === 'NEGATIVE' ? -score : 0;

    return { label, score, normalized };
  } catch {
    // QNBS-v3: [Graceful degrade — same fallback v1 returned on any worker failure.]
    return { label: 'NEUTRAL', score: 0.5, normalized: 0 };
  }
}

export async function summarizeText(text: string, maxLength = MAX_SUMMARY_TOKENS): Promise<string> {
  const capped = text.slice(0, 1024);

  try {
    return await requestInference('summarization', SUMMARIZATION_MODEL, capped, {
      max_new_tokens: maxLength,
      do_sample: false,
    });
  } catch {
    return text.slice(0, 280); // graceful degrade
  }
}

// QNBS-v3: Zero-shot topic classification for creative-writing genres using sentiment model heuristic.
//          In future: replace with Xenova/facebook-bart-large-mnli (zero-shot) when model available.
export async function classifyWritingTopic(text: string): Promise<string> {
  const keywords: Record<string, string[]> = {
    Fantasy: ['dragon', 'magic', 'wizard', 'elf', 'quest', 'realm', 'spell'],
    SciFi: ['spaceship', 'robot', 'alien', 'galaxy', 'quantum', 'android', 'AI'],
    Thriller: ['murder', 'detective', 'conspiracy', 'secret', 'chase', 'crime'],
    Romance: ['love', 'heart', 'kiss', 'relationship', 'wedding', 'feelings'],
    Horror: ['fear', 'monster', 'dark', 'ghost', 'haunted', 'terror', 'evil'],
    Mystery: ['clue', 'suspect', 'investigate', 'puzzle', 'mystery', 'witness'],
  };

  const lower = text.toLowerCase();
  let bestGenre = 'General Fiction';
  let bestScore = 0;

  for (const [genre, words] of Object.entries(keywords)) {
    const score = words.filter((w) => lower.includes(w)).length;
    if (score > bestScore) {
      bestScore = score;
      bestGenre = genre;
    }
  }

  return bestGenre;
}
