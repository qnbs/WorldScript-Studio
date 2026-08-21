// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  extractHeadersFileValue,
  extractNginxHeaderValue,
  extractVercelHeaderValue,
  group1,
} from '../utils/deploymentConfigParsers';

// QNBS-v3: keep deployment headers present, aligned, and no looser than the meta CSP after the ADR-0004 correction.

// QNBS-v3: all web and native surfaces share explicit origins so unlisted BYOK endpoints cannot widen egress.

const webHtml = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8');
const tauriConf = readFileSync(
  fileURLToPath(new URL('../../src-tauri/tauri.conf.json', import.meta.url)),
  'utf8',
);
const cspCheckerSource = readFileSync(
  fileURLToPath(new URL('../../scripts/check-csp-policy.mjs', import.meta.url)),
  'utf8',
);

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

describe('CSP connect-src — shared explicit egress policy', () => {
  // QNBS-v3: keep the Tauri loopback policy fail-closed instead of trusting a surface-specific exception.
  it('checks upgrade-insecure-requests on the Tauri surface too', () => {
    expect(tauriCsp()).not.toContain('upgrade-insecure-requests');
    expect(cspCheckerSource).not.toContain("relativePath !== 'src-tauri/tauri.conf.json'");
  });

  describe('web PWA (index.html)', () => {
    const tokens = connectSrcTokens(webCsp());

    it('does not allow arbitrary HTTPS egress', () => {
      expect(tokens).not.toContain('https:');
    });

    it('has no `http:` or `ws:` scheme-wildcards (cleartext exfiltration stays blocked)', () => {
      // `http://localhost:11434` and `wss://…` are explicit origins and allowed;
      // bare scheme tokens `http:` / `ws:` would be wildcards and are not.
      expect(tokens).not.toContain('http:');
      expect(tokens).not.toContain('ws:');
    });

    it('enumerates every supported cloud provider explicitly', () => {
      for (const origin of [
        'https://generativelanguage.googleapis.com',
        'https://api.openai.com',
        'https://api.x.ai',
        'https://api.anthropic.com',
        'https://api.groq.com',
        'https://openrouter.ai',
        'https://api.openrouter.ai',
        'https://huggingface.co',
        'https://us.aws.cdn.hf.co',
      ]) {
        expect(tokens).toContain(origin);
      }
    });

    it('keeps the explicitly supported local-service origins', () => {
      expect(tokens).toContain('http://localhost:11434'); // Ollama
      expect(tokens).toContain('http://localhost:1234'); // LM Studio
      expect(tokens).toContain('http://localhost:8000'); // local AI
      expect(tokens).toContain('http://localhost:8010'); // LanguageTool
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

describe('CSP response headers — ADR-0004 revision (host header actually exists now)', () => {
  const vercelJson = readFileSync(
    fileURLToPath(new URL('../../vercel.json', import.meta.url)),
    'utf8',
  );
  const headersFile = readFileSync(
    fileURLToPath(new URL('../../public/_headers', import.meta.url)),
    'utf8',
  );
  const nginxConf = readFileSync(
    fileURLToPath(new URL('../../nginx.conf', import.meta.url)),
    'utf8',
  );

  function vercelCsp(): string {
    return extractVercelHeaderValue(vercelJson, 'Content-Security-Policy');
  }
  function headersCsp(): string {
    return extractHeadersFileValue(headersFile, 'Content-Security-Policy');
  }
  function nginxHeaderCsp(): string {
    return extractNginxHeaderValue(nginxConf, 'Content-Security-Policy');
  }

  /** Split a CSP string into a directive -> token-set map for per-directive comparison. */
  function directiveMap(csp: string): Map<string, Set<string>> {
    const map = new Map<string, Set<string>>();
    for (const part of csp.split(';')) {
      const tokens = part.trim().split(/\s+/).filter(Boolean);
      const directive = tokens[0];
      if (!directive) continue;
      map.set(directive, new Set(tokens.slice(1)));
    }
    return map;
  }

  it('all three hosts that can set headers set an identical Content-Security-Policy', () => {
    expect(vercelCsp()).toBe(headersCsp());
    expect(headersCsp()).toBe(nginxHeaderCsp());
  });

  it('the header CSP is never looser than the meta CSP for any shared directive', () => {
    const metaDirectives = directiveMap(webCsp());
    const headerDirectives = directiveMap(vercelCsp());
    for (const [directive, headerTokens] of headerDirectives) {
      const metaTokens = metaDirectives.get(directive);
      if (!metaTokens) continue; // a header-only directive (e.g. frame-ancestors) adds hardening
      for (const token of headerTokens) {
        expect(
          metaTokens.has(token),
          `header ${directive} allows "${token}" that the meta CSP does not`,
        ).toBe(true);
      }
    }
  });

  it('gains frame-ancestors as real enforcement (inert in the meta tag, effective as a header)', () => {
    const headerDirectives = directiveMap(vercelCsp());
    expect(headerDirectives.get('frame-ancestors')).toBeDefined();
    expect(headerDirectives.get('frame-ancestors')?.has("'none'")).toBe(true);
  });
});
