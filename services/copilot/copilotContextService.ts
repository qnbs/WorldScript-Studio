/**
 * Copilot context service — pure helpers that make the Global Copilot context-aware.
 * QNBS-v3: Builds the beginner-friendly system prompt from the user's current location in the app
 * plus lightweight project facts. No React, no Redux — fully unit-testable.
 */

export interface CopilotContext {
  /** Raw view id (e.g. 'manuscript'). */
  view: string;
  /** Localized, human-readable view label. */
  viewLabel: string;
  /** Project title (may be empty). */
  projectTitle: string;
  /** Approximate manuscript word count. */
  wordCount: number;
  /** UI language code — the assistant replies in this language. */
  language: string;
}

/** Short, capability-oriented descriptions per view to ground the assistant's "what can I do here?". */
const VIEW_HINTS: Record<string, string> = {
  dashboard: 'project overview, health score, and quick actions',
  manuscript: 'the chapter/scene editor with the navigator and research binder',
  writer: 'the focused AI writing studio with streaming Co-Pilot suggestions',
  templates: 'starting a new project from a genre template',
  outline: 'the AI outline generator',
  characters: 'character profiles and the Codex',
  world: 'world-building entries',
  export: 'compiling and exporting the manuscript',
  settings: 'app settings, AI providers, appearance, and privacy',
  help: 'help articles and guides',
  sceneboard: 'the plot board with connections, subplots, and tension curve',
  characterGraph: 'the character relationship graph',
  consistencyChecker: 'the AI consistency checker',
  critic: 'the AI critic review',
  preview: 'the book preview / read mode',
  progress: 'writing goals, streaks, and session tracking',
  objects: 'story objects and groups inventory',
  mindmap: 'the mind-map canvas',
  characterInterviews: 'AI character interviews',
  lora: 'LoRA fine-tuning of local models',
};

/** Build the system prompt that primes the Copilot to be a helpful, location-aware guide. */
export function buildSystemPrompt(ctx: CopilotContext): string {
  const hint = VIEW_HINTS[ctx.view] ?? 'this screen';
  const projectLine = ctx.projectTitle
    ? `The user is working on a project titled "${ctx.projectTitle}" (~${ctx.wordCount} words).`
    : 'The user has not added much content yet.';

  return [
    'You are the StoryCraft Studio Copilot — a warm, encouraging writing assistant for beginners.',
    'StoryCraft Studio is an offline-first creative-writing app. The AI is always called the "Co-Pilot".',
    'Keep answers short, concrete, and jargon-free. Prefer numbered steps for how-to questions.',
    'When the user asks "what can I do here", explain the current screen specifically.',
    `The user is currently on the "${ctx.viewLabel}" screen, which is ${hint}.`,
    projectLine,
    `Always respond in this language code: ${ctx.language}.`,
    'If a request needs a feature elsewhere in the app, name the screen and offer to open it.',
    'Never invent app features that were not described to you.',
  ].join('\n');
}

/** Assemble a single prompt string (system + short history + new turn) for stream completion. */
export function assembleCopilotPrompt(
  systemPrompt: string,
  history: Array<{ role: string; content: string }>,
  userMessage: string,
  maxHistory = 8,
): string {
  const recent = history.slice(-maxHistory);
  const convo = recent
    .map((m) => `${m.role === 'user' ? 'User' : 'Copilot'}: ${m.content}`)
    .join('\n');
  return [systemPrompt, '', convo, `User: ${userMessage}`, 'Copilot:'].filter(Boolean).join('\n');
}
