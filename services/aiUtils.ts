/**
 * Shared AI utility functions used by geminiService and aiProviderService.
 */

/** Strip ASCII/C1 control characters, replacing them with spaces. */
export const stripControlChars = (value: string): string => {
  let output = '';
  for (const char of String(value)) {
    const code = char.charCodeAt(0);
    output += code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f) ? ' ' : char;
  }
  return output;
};

/** Sanitize a prompt value: strip control chars, collapse whitespace, remove fences. */
export const sanitizePromptValue = (input: unknown): string =>
  stripControlChars(String(input ?? ''))
    .replace(/```/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

/** Sanitize a prompt block: like sanitizePromptValue but preserves paragraph breaks. */
export const sanitizePromptBlock = (input: unknown): string =>
  stripControlChars(String(input ?? ''))
    .replace(/```/g, '"')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** Clean a full prompt string (alias for sanitizePromptBlock). */
export const cleanPrompt = (prompt: string): string => sanitizePromptBlock(prompt);

/** Attach a cause to an Error without making it enumerable. */
export const attachCause = <T extends Error>(error: T, cause: unknown): T => {
  Object.defineProperty(error, 'cause', {
    value: cause,
    enumerable: false,
    configurable: true,
  });
  return error;
};

/** Strip markdown JSON fences (```json ... ```) from an AI response. */
export const stripJsonFences = (raw: string): string => {
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '');
  }
  return text;
};
