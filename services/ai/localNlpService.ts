// QNBS-v3: Local NLP service — sentiment, summarization, topic classification via inference.worker.ts.
//          Adapted from CannaGuide-2025 nlpService.ts patterns for creative-writing context.
//          All inference runs off-main-thread; falls back gracefully when worker unavailable.

export interface SentimentResult {
  label: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  score: number; // 0–1 confidence
  normalized: number; // -1 to +1 (NEGATIVE → -score, POSITIVE → +score)
}

const SENTIMENT_MODEL = 'Xenova/distilbert-base-uncased-finetuned-sst-2-english';
const SUMMARIZATION_MODEL = 'Xenova/distilbart-cnn-6-6';
const MAX_SUMMARY_TOKENS = 150;

let workerInstance: Worker | null = null;

function getWorker(): Worker {
  if (!workerInstance) {
    workerInstance = new Worker(new URL('../../workers/inference.worker.ts', import.meta.url), {
      type: 'module',
    });
  }
  return workerInstance;
}

function postToWorker(
  task: string,
  modelId: string,
  input: string,
  inferenceOptions?: Record<string, unknown>,
): Promise<{ ok: boolean; result?: string; error?: string }> {
  return new Promise((resolve) => {
    const messageId = `nlp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const worker = getWorker();

    const handler = (event: MessageEvent) => {
      const data = event.data as {
        messageId: string;
        ok: boolean;
        result?: string;
        error?: string;
      };
      if (data.messageId !== messageId) return;
      worker.removeEventListener('message', handler);
      resolve(data);
    };

    worker.addEventListener('message', handler);
    worker.postMessage({ messageId, task, modelId, input, inferenceOptions });
  });
}

export async function analyzeSentiment(text: string): Promise<SentimentResult> {
  const capped = text.slice(0, 512); // model input limit
  const response = await postToWorker('sentiment-analysis', SENTIMENT_MODEL, capped);

  if (!response.ok || !response.result) {
    return { label: 'NEUTRAL', score: 0.5, normalized: 0 };
  }

  // Worker returns "LABEL:score" string (see inference.worker.ts sentiment handler)
  const [labelRaw, scoreRaw] = response.result.split(':');
  const rawLabel = (labelRaw ?? 'NEUTRAL').toUpperCase();
  const score = parseFloat(scoreRaw ?? '0.5');

  const label: SentimentResult['label'] =
    rawLabel === 'POSITIVE' ? 'POSITIVE' : rawLabel === 'NEGATIVE' ? 'NEGATIVE' : 'NEUTRAL';

  const normalized = label === 'POSITIVE' ? score : label === 'NEGATIVE' ? -score : 0;

  return { label, score, normalized };
}

export async function summarizeText(text: string, maxLength = MAX_SUMMARY_TOKENS): Promise<string> {
  const capped = text.slice(0, 1024);
  const response = await postToWorker('summarization', SUMMARIZATION_MODEL, capped, {
    max_new_tokens: maxLength,
    do_sample: false,
  });

  if (!response.ok || !response.result) return text.slice(0, 280); // graceful degrade
  return response.result;
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

export function _resetWorkerForTest(): void {
  if (workerInstance) {
    workerInstance.terminate();
    workerInstance = null;
  }
}
