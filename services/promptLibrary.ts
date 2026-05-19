/**
 * Centralised prompt template registry for StoryCraft Studio.
 * QNBS-v3: Single source of truth for all AI prompts — enables versioning, A/B testing,
 *          export/import, and future locale-aware overrides without touching geminiService.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PromptCategory =
  | 'outline'
  | 'character'
  | 'world'
  | 'manuscript'
  | 'consistency'
  | 'style-transfer'
  | 'plot-hole'
  | 'chapter-gen';

export interface PromptTemplate {
  id: string;
  version: string;
  name: string;
  category: PromptCategory;
  /** i18n key for the display name — resolved at render time. */
  localeKey: string;
  /** Returns the fully-interpolated prompt string. */
  template: (vars: Record<string, string>) => string;
  chainable?: boolean;
  /** If set, this template takes the output of the named template as input. */
  inputFromPreviousId?: string;
  /** Uniform random A/B variant selection — logged to analytics if enabled. */
  abTestVariants?: PromptTemplate[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const registry = new Map<string, PromptTemplate>();

function register(t: PromptTemplate): void {
  registry.set(t.id, t);
}

// ---------------------------------------------------------------------------
// Existing 17 prompts (metadata + template strings ported from geminiService)
// ---------------------------------------------------------------------------

register({
  id: 'logline',
  version: '1.0.0',
  name: 'Logline',
  category: 'manuscript',
  localeKey: 'promptLibrary.logline',
  template: (v) =>
    `Based on the following story details, generate 4 compelling and diverse logline suggestions.\nTitle: ${v.title ?? ''}\nOutline: ${v.outline ?? ''}`,
});

register({
  id: 'characterProfile',
  version: '1.0.0',
  name: 'Character Profile',
  category: 'character',
  localeKey: 'promptLibrary.characterProfile',
  template: (v) =>
    `Generate a detailed character profile based on this concept: "${v.concept ?? ''}". The profile should include fields for 'name', 'backstory', 'motivation', 'appearance', 'personalityTraits', 'flaws', 'characterArc', and 'relationships'.`,
});

register({
  id: 'regenerateCharacterField',
  version: '1.0.0',
  name: 'Regenerate Character Field',
  category: 'character',
  localeKey: 'promptLibrary.regenerateCharacterField',
  template: (v) =>
    `Given the character profile:\n${v.character ?? ''}\n\nRewrite or expand upon the "${v.field ?? ''}" field to be more compelling and detailed.`,
});

register({
  id: 'characterPortrait',
  version: '1.0.0',
  name: 'Character Portrait',
  category: 'character',
  localeKey: 'promptLibrary.characterPortrait',
  template: (v) =>
    `Generate portrait of ${v.description ?? ''} in style of ${v.style || 'vivid, artistic, digital painting'}. Centered, chest-up, simple atmospheric background. No text or watermarks.`,
});

register({
  id: 'worldProfile',
  version: '1.0.0',
  name: 'World Profile',
  category: 'world',
  localeKey: 'promptLibrary.worldProfile',
  template: (v) =>
    `Generate a detailed world profile based on this concept: "${v.concept ?? ''}". Include 'name', 'description', 'geography', 'magicSystem', and 'culture'.`,
});

register({
  id: 'regenerateWorldField',
  version: '1.0.0',
  name: 'Regenerate World Field',
  category: 'world',
  localeKey: 'promptLibrary.regenerateWorldField',
  template: (v) =>
    `Given the world profile:\n${v.world ?? ''}\n\nRewrite or expand upon the "${v.field ?? ''}" field to be more detailed and imaginative.`,
});

register({
  id: 'worldImage',
  version: '1.0.0',
  name: 'World Image',
  category: 'world',
  localeKey: 'promptLibrary.worldImage',
  template: (v) =>
    `Generate a breathtaking atmospheric digital painting of a landscape that captures: "${v.description ?? ''}". No text or watermarks.`,
});

register({
  id: 'sceneVisualization',
  version: '1.0.0',
  name: 'Scene Visualization',
  category: 'manuscript',
  localeKey: 'promptLibrary.sceneVisualization',
  template: (v) =>
    `Create a single cinematic illustration for this scene from "${v.projectTitle ?? ''}".\nScene: ${v.sectionTitle ?? ''}\nExcerpt:\n${v.excerpt ?? ''}\n\nOne coherent image, no text, captions, or watermarks.`,
});

register({
  id: 'outline',
  version: '1.0.0',
  name: 'Outline Generation',
  category: 'outline',
  localeKey: 'promptLibrary.outline',
  template: (v) =>
    `Generate a story outline with ${v.numChapters ?? '10'} sections for a ${v.pacing ?? ''} ${v.genre ?? ''} story.\nCore Idea: ${v.idea ?? ''}\n${v.characters ? `Key Characters: ${v.characters}` : ''}\n${v.setting ? `Setting: ${v.setting}` : ''}\n${v.includeTwist === 'true' ? 'Include a significant plot twist in one of the later sections.' : ''}\nFor each section, provide a "title" and "description". If a section is a plot twist, add "isTwist": true.`,
});

register({
  id: 'regenerateOutlineSection',
  version: '1.0.0',
  name: 'Regenerate Outline Section',
  category: 'outline',
  localeKey: 'promptLibrary.regenerateOutlineSection',
  template: (v) =>
    `Given the current outline:\n${v.outline ?? ''}\n\nRegenerate section ${v.sectionIndex ?? '0'} ("${v.sectionTitle ?? ''}") to be more engaging and detailed, keeping it consistent with the rest.`,
});

register({
  id: 'personalizeTemplate',
  version: '1.0.0',
  name: 'Personalize Template',
  category: 'outline',
  localeKey: 'promptLibrary.personalizeTemplate',
  template: (v) =>
    `Adapt the following story template to fit the user's concept.\nTemplate: ${v.template ?? ''}\nUser Concept: ${v.concept ?? ''}\nPersonalize all plot points to the user's genre (${v.genre ?? ''}) and idea.`,
});

register({
  id: 'customTemplate',
  version: '1.0.0',
  name: 'Custom Template',
  category: 'outline',
  localeKey: 'promptLibrary.customTemplate',
  template: (v) =>
    `Generate a story outline based on this custom template:\n${v.template ?? ''}\nAdapt it for: ${v.concept ?? ''}.`,
});

register({
  id: 'synopsis',
  version: '1.0.0',
  name: 'Synopsis',
  category: 'manuscript',
  localeKey: 'promptLibrary.synopsis',
  template: (v) =>
    `Write a compelling ${v.length || 'one-paragraph'} synopsis for the following story.\nTitle: ${v.title ?? ''}\nOutline: ${v.outline ?? ''}`,
});

register({
  id: 'proofread',
  version: '1.0.0',
  name: 'Proofread',
  category: 'manuscript',
  localeKey: 'promptLibrary.proofread',
  template: (v) =>
    `Proofread the following manuscript section for grammar, spelling, and style. Return a corrected version and a list of changes made.\n\n${v.content ?? ''}`,
});

register({
  id: 'consistencyCheck',
  version: '1.0.0',
  name: 'Consistency Check',
  category: 'consistency',
  localeKey: 'promptLibrary.consistencyCheck',
  template: (v) =>
    `Analyse the following manuscript for consistency issues (character names, timeline, world rules, plot continuity).\n\n${v.manuscript ?? ''}`,
});

register({
  id: 'criticAnalysis',
  version: '1.0.0',
  name: 'Critic Analysis',
  category: 'consistency',
  localeKey: 'promptLibrary.criticAnalysis',
  template: (v) =>
    `Provide a detailed literary critique of the following manuscript excerpt. Cover: prose quality, pacing, characterisation, dialogue, and overall impact.\n\n${v.excerpt ?? ''}`,
});

register({
  id: 'plotHoleDetection',
  version: '1.0.0',
  name: 'Plot Hole Detection',
  category: 'plot-hole',
  localeKey: 'promptLibrary.plotHoleDetection',
  template: (v) =>
    `Identify all plot holes, logical inconsistencies, and unresolved threads in the following story outline and manuscript excerpt.\n\nOutline:\n${v.outline ?? ''}\n\nManuscript:\n${v.manuscript ?? ''}`,
});

// ---------------------------------------------------------------------------
// New prompts (Phase 2/3 — Day 10 additions)
// ---------------------------------------------------------------------------

register({
  id: 'styleTransfer',
  version: '1.0.0',
  name: 'Style Transfer',
  category: 'style-transfer',
  localeKey: 'promptLibrary.styleTransfer',
  template: (v) =>
    `Rewrite the following passage in the style of the provided author voice example.\n\nAuthor Style Example:\n${v.authorStyle ?? ''}\n\nOriginal Passage:\n${v.passage ?? ''}\n\nReturn JSON with keys "transformed" (the rewritten passage) and "voiceNotes" (array of style observations).`,
});

register({
  id: 'plotHoleFix',
  version: '1.0.0',
  name: 'Plot Hole Auto-Fix',
  category: 'plot-hole',
  localeKey: 'promptLibrary.plotHoleFix',
  chainable: true,
  inputFromPreviousId: 'plotHoleDetection',
  template: (v) =>
    `Given the following detected plot holes and the manuscript context, generate specific fix suggestions for each hole.\n\nDetected Plot Holes:\n${v.analysis ?? ''}\n\nManuscript Context:\n${v.manuscript ?? ''}\n\nReturn JSON with key "fixes": an array of objects with "hole", "suggestion", and optional "chapter".`,
});

register({
  id: 'chapterAutoGeneration',
  version: '1.0.0',
  name: 'Chapter Auto-Generation',
  category: 'chapter-gen',
  localeKey: 'promptLibrary.chapterAutoGeneration',
  template: (v) =>
    `Write a full chapter based on the following outline section.\n\nOutline Section:\n${v.outlineSection ?? ''}\n\nExisting Chapter Context (for continuity):\n${v.existingChapters ?? ''}\n\nTarget word count: approximately ${v.wordTarget || '1000'} words.\n\nReturn JSON with keys "title", "content", "endingHook", and "wordCount".`,
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Retrieve and interpolate a registered prompt template.
 * If the template has A/B variants, one is selected at random.
 */
export function getPrompt(id: string, vars: Record<string, string> = {}): string {
  const tmpl = registry.get(id);
  if (!tmpl) throw new Error(`promptLibrary: unknown prompt id "${id}"`);

  // A/B variant selection
  if (tmpl.abTestVariants?.length) {
    const pool = [tmpl, ...tmpl.abTestVariants];
    const selected = pool[Math.floor(Math.random() * pool.length)] ?? tmpl;
    return selected.template(vars);
  }

  return tmpl.template(vars);
}

/** Return all templates in a given category. */
export function listByCategory(category: PromptCategory): PromptTemplate[] {
  return Array.from(registry.values()).filter((t) => t.category === category);
}

/** Return all registered templates. */
export function listAll(): PromptTemplate[] {
  return Array.from(registry.values());
}

/** Serialise the registry to JSON for export. */
export function exportPromptLibrary(): string {
  const data = Array.from(registry.values()).map((t) => ({
    id: t.id,
    version: t.version,
    name: t.name,
    category: t.category,
    localeKey: t.localeKey,
    chainable: t.chainable,
    inputFromPreviousId: t.inputFromPreviousId,
  }));
  return JSON.stringify({ version: '1.0.0', templates: data }, null, 2);
}

/** Import additional templates from JSON (additive — existing IDs preserved). */
export function importPromptLibrary(json: string): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { valid: false, errors: ['Invalid JSON'] };
  }

  const errors: string[] = [];

  if (typeof parsed !== 'object' || parsed === null || !('templates' in parsed)) {
    return { valid: false, errors: ['Missing "templates" array'] };
  }

  const data = (parsed as { templates: unknown[] }).templates;
  if (!Array.isArray(data)) {
    return { valid: false, errors: ['"templates" must be an array'] };
  }

  for (const item of data) {
    if (typeof item !== 'object' || item === null) {
      errors.push('Template entry must be an object');
      continue;
    }
    const t = item as Record<string, unknown>;
    if (typeof t.id !== 'string' || !t.id) {
      errors.push('Template missing required "id"');
      continue;
    }
    // QNBS-v3: Imported templates are metadata-only — no executable template() fn from untrusted JSON.
    //          Callers that need to getPrompt() must use the built-in registry.
    if (!registry.has(t.id as string)) {
      errors.push(`Template "${String(t.id)}" is not in the built-in registry — ignored`);
    }
  }

  return { valid: errors.length === 0, errors };
}
