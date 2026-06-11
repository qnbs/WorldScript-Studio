/**
 * Intent Engine — context-aware natural language command parsing.
 * QNBS-v3: Hybrid approach: exact template matching + fuzzy keyword scoring.
 */

import { logger } from '../logger';
import { STATIC_VOICE_COMMANDS } from './commandVoiceMappings';
import type {
  IntentContext,
  IntentEngine,
  ParsedIntent,
  VoiceCommandDefinition,
} from './voiceTypes';

export class HybridIntentEngine implements IntentEngine {
  readonly name = 'Hybrid Intent Engine';

  private commands: VoiceCommandDefinition[] = [...STATIC_VOICE_COMMANDS];
  private templateMap = new Map<string, string>();
  private readonly fuzzyThreshold = 0.6;

  async initialize(): Promise<void> {
    this.rebuildIndex();
  }

  registerCommands(commands: VoiceCommandDefinition[]): void {
    this.commands = commands;
    this.rebuildIndex();
  }

  private rebuildIndex(): void {
    this.templateMap = new Map();
    for (const cmd of this.commands) {
      for (const template of cmd.templates) {
        this.templateMap.set(template.toLowerCase().trim(), cmd.id);
      }
    }
  }

  parse(transcript: string, context: IntentContext): ParsedIntent | null {
    const cleaned = transcript.toLowerCase().trim();

    // 1. Exact template match (with view context filtering)
    const exactId = this.templateMap.get(cleaned);
    if (exactId) {
      const exactCmd = this.commands.find((c) => c.id === exactId);
      if (
        !exactCmd ||
        exactCmd.requiredViews.length === 0 ||
        exactCmd.requiredViews.includes(context.currentView)
      ) {
        return {
          commandId: exactId,
          confidence: 1.0,
          slots: [],
          transcript,
        };
      }
    }

    // 2. Fuzzy keyword scoring with view context filtering
    let bestMatch: { commandId: string; score: number; slots: ParsedIntent['slots'] } | null = null;

    for (const cmd of this.commands) {
      // Filter by required view context
      if (cmd.requiredViews.length > 0 && !cmd.requiredViews.includes(context.currentView)) {
        continue;
      }

      const score = this.scoreCommand(cleaned, cmd, context);
      if (score > this.fuzzyThreshold && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { commandId: cmd.id, score, slots: [] };
      }
    }

    if (bestMatch) {
      return {
        commandId: bestMatch.commandId,
        confidence: bestMatch.score,
        slots: bestMatch.slots,
        transcript,
      };
    }

    // 3. Slot extraction for navigation patterns like "open {view}"
    const navSlot = this.extractNavigationSlot(cleaned);
    if (navSlot) {
      const navCommand = this.findNavigationCommand(navSlot.view);
      if (navCommand) {
        return {
          commandId: navCommand,
          confidence: 0.75,
          slots: [{ name: 'view', value: navSlot.view }],
          transcript,
        };
      }
    }

    // QNBS-v3: C-P0 — never log the raw transcript (user speech is PII; the IDB log sink persists
    //          it). Log only a non-identifying length so the "no match" case stays debuggable.
    logger.debug('No intent match', { transcriptLength: cleaned.length });
    return null;
  }

  private scoreCommand(
    transcript: string,
    cmd: VoiceCommandDefinition,
    _context: IntentContext,
  ): number {
    let maxScore = 0;

    for (const template of cmd.templates) {
      const score = this.computeSimilarity(transcript, template);
      if (score > maxScore) maxScore = score;
    }

    // Boost by keyword overlap
    const keywordBoost = cmd.keywords.reduce((acc, kw) => {
      return transcript.includes(kw.toLowerCase()) ? acc + 0.1 : acc;
    }, 0);

    return Math.min(maxScore + keywordBoost, 1.0);
  }

  private computeSimilarity(a: string, b: string): number {
    // Simple Jaccard similarity on word sets
    const setA = new Set(a.split(/\s+/));
    const setB = new Set(b.split(/\s+/));
    const intersection = new Set([...setA].filter((x) => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    if (union.size === 0) return 0;
    return intersection.size / union.size;
  }

  private extractNavigationSlot(transcript: string): { view: string } | null {
    const patterns = [
      /^(?:open|show|go to|navigate to|switch to)\s+(.+)$/,
      /^(?:take me to|bring me to)\s+(.+)$/,
    ];

    for (const pattern of patterns) {
      const match = pattern.exec(transcript);
      if (match?.[1]) {
        return { view: match[1].trim() };
      }
    }
    return null;
  }

  private findNavigationCommand(viewName: string): string | null {
    const viewMap: Record<string, string> = {
      dashboard: 'global-dashboard',
      manuscript: 'editor-manuscript',
      writer: 'ai-writer',
      settings: 'nav-settings',
      help: 'help-open',
      'plot board': 'editor-scene-board',
      'scene board': 'editor-scene-board',
      outline: 'editor-outline',
      characters: 'editor-characters',
      world: 'editor-world',
      export: 'editor-export',
      analytics: 'editor-analytics',
      'mind map': 'editor-mindmap',
      mindmap: 'editor-mindmap',
      progress: 'editor-analytics',
      preview: 'editor-preview',
      templates: 'editor-templates',
    };

    const normalized = viewName.toLowerCase().trim();
    return viewMap[normalized] ?? null;
  }
}
