// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// QNBS-v3: Regression guard for ADR-0004 (audit finding F-2). The web PWA connect-src keeps a
// `https:` scheme-source ON PURPOSE — it is required by the shipped BYOK `openAiCompatibleBaseUrl`
// feature (arbitrary user-configured HTTPS proxies that cannot be enumerated in a meta CSP). The
// per-provider HTTPS entries were removed as dead allowlist entries (redundant under `https:`).
// The native Tauri CSP must stay strict (NO `https:` blanket). These assertions lock that contract.

const webHtml = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8');
const tauriConf = readFileSync(
  fileURLToPath(new URL('../../src-tauri/tauri.conf.json', import.meta.url)),
  'utf8',
);

/** Extract capture group 1 with a narrowing guard (noUncheckedIndexedAccess-safe). */
function group1(m: RegExpMatchArray | null, msg: string): string {
  if (!m || m[1] === undefined) throw new Error(msg);
  return m[1];
}

/** Pull the `connect-src …;` directive value out of a CSP string, normalized to whitespace tokens. */
function connectSrcTokens(csp: string): string[] {
  return group1(csp.match(/connect-src([^;]*);/), 'connect-src directive must exist')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** The web CSP lives in a multi-line <meta http-equiv="Content-Security-Policy" content="…">. */
function webCsp(): string {
  return group1(
    webHtml.match(/Content-Security-Policy"\s*\n?\s*content="([\s\S]*?)"/),
    'web CSP meta must exist in index.html',
  );
}

/** Tauri v2 keeps the CSP at app.security.csp. */
function tauriCsp(): string {
  const conf = JSON.parse(tauriConf) as { app?: { security?: { csp?: string } } };
  const csp = conf.app?.security?.csp;
  expect(typeof csp, 'Tauri csp must be a string at app.security.csp').toBe('string');
  return csp as string;
}

describe('CSP connect-src — ADR-0004 BYOK tradeoff', () => {
  describe('web PWA (index.html)', () => {
    const tokens = connectSrcTokens(webCsp());

    it('keeps the intentional `https:` scheme-source (required by BYOK openAiCompatibleBaseUrl)', () => {
      expect(tokens).toContain('https:');
    });

    it('has no `http:` or `ws:` scheme-wildcards (cleartext exfiltration stays blocked)', () => {
      // `http://localhost:11434` and `wss://…` are explicit origins and allowed;
      // bare scheme tokens `http:` / `ws:` would be wildcards and are not.
      expect(tokens).not.toContain('http:');
      expect(tokens).not.toContain('ws:');
    });

    it('removed the redundant explicit cloud-provider endpoints (covered by `https:`)', () => {
      for (const dead of [
        'https://generativelanguage.googleapis.com',
        'https://api.openai.com',
        'https://api.x.ai',
        'https://api.groq.com',
        'https://openrouter.ai',
        'https://api.openrouter.ai',
      ]) {
        expect(tokens).not.toContain(dead);
      }
    });

    it('keeps the local-inference origins `https:` does not cover', () => {
      expect(tokens).toContain('http://localhost:11434'); // Ollama
      expect(tokens).toContain('http://localhost:1234'); // LM Studio
      expect(tokens).toContain('http://localhost:8000'); // local AI
    });
  });

  describe('native Tauri (tauri.conf.json)', () => {
    const tokens = connectSrcTokens(tauriCsp());

    it('does NOT contain a `https:` scheme-source blanket (strict egress)', () => {
      // Explicit `https://api.openai.com` tokens are fine; a bare `https:` token is not.
      expect(tokens).not.toContain('https:');
    });

    it('enumerates cloud providers explicitly (allowlist is meaningful here)', () => {
      expect(tokens).toContain('https://api.openai.com');
    });
  });
});
