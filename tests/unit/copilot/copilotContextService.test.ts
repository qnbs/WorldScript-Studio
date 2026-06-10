import { describe, expect, it } from 'vitest';
import {
  assembleCopilotPrompt,
  buildSystemPrompt,
  type CopilotContext,
} from '../../../services/copilot/copilotContextService';

const ctx: CopilotContext = {
  view: 'manuscript',
  viewLabel: 'Manuscript',
  projectTitle: 'My Novel',
  wordCount: 1234,
  language: 'de',
};

describe('copilotContextService', () => {
  describe('buildSystemPrompt', () => {
    it('embeds the current view, project, and language', () => {
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).toContain('Manuscript');
      expect(prompt).toContain('My Novel');
      expect(prompt).toContain('1234');
      expect(prompt).toContain('de');
      expect(prompt).toContain('Co-Pilot');
    });

    it('handles an empty project gracefully', () => {
      const prompt = buildSystemPrompt({ ...ctx, projectTitle: '', wordCount: 0 });
      expect(prompt).toContain('not added much content');
    });
  });

  describe('assembleCopilotPrompt', () => {
    it('includes recent history and ends with the user turn + Copilot cue', () => {
      const prompt = assembleCopilotPrompt(
        'SYSTEM',
        [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
        ],
        'what next?',
      );
      expect(prompt).toContain('SYSTEM');
      expect(prompt).toContain('User: hi');
      expect(prompt).toContain('Copilot: hello');
      expect(prompt.trimEnd().endsWith('User: what next?\nCopilot:')).toBe(true);
    });

    it('truncates history to maxHistory', () => {
      const history = Array.from({ length: 20 }, (_, i) => ({
        role: 'user',
        content: `m${i}`,
      }));
      const prompt = assembleCopilotPrompt('S', history, 'now', 4);
      expect(prompt).toContain('m19');
      expect(prompt).not.toContain('m10');
    });
  });
});
