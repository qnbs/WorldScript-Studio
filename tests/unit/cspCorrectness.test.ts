// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  extractHeadersFileValue,
  extractVercelHeaderValue,
  group1,
} from '../utils/deploymentConfigParsers';

// QNBS-v3: Layer B of the 3-layer CSP test architecture (docs/adr/0013-csp-wasm-and-blob-frames.md).
// csp.test.ts / deploymentHeaders.test.ts (Layer A) only assert CONSISTENCY between the 5
// deployment surfaces — 4 identically-broken CSPs pass Layer A with a clean bill of health, which
// is exactly how `script-src 'self'` (no `'wasm-unsafe-eval'`) shipped undetected for two months
// (F-01). This file asserts FUNCTIONAL correctness of the directives themselves. Layer C is the
// real-browser runtime probe in scripts/smoke-prod-build.mjs.

const webHtml = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8');
const vercelJson = readFileSync(
  fileURLToPath(new URL('../../vercel.json', import.meta.url)),
  'utf8',
);
const headersFile = readFileSync(
  fileURLToPath(new URL('../../public/_headers', import.meta.url)),
  'utf8',
);
const nginxConf = readFileSync(fileURLToPath(new URL('../../nginx.conf', import.meta.url)), 'utf8');
const tauriConf = readFileSync(
  fileURLToPath(new URL('../../src-tauri/tauri.conf.json', import.meta.url)),
  'utf8',
);

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

/**
 * All `add_header Content-Security-Policy "…";` occurrences in nginx.conf. There must be exactly
 * 3 (server level + /assets block + /sw.js block) — nginx's `add_header` does not inherit into a
 * `location` block that sets any `add_header` of its own, so each block needs its own copy.
 */
function nginxCsps(): string[] {
  return [...nginxConf.matchAll(/add_header Content-Security-Policy "([^"]*)"/g)].map((m) => {
    const value = m[1];
    if (value === undefined) throw new Error('nginx CSP capture group missing');
    return value;
  });
}

/** Split a single directive's value out of a CSP string into whitespace tokens, or undefined if absent. */
function directiveTokens(csp: string, directive: string): string[] | undefined {
  const m = csp.match(new RegExp(`(?:^|;)\\s*${directive}([^;]*);`));
  if (!m || m[1] === undefined) return undefined;
  return m[1]
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** All inline <script>…</script> bodies in index.html that have no `src` attribute and non-empty content. */
function inlineScriptContents(html: string): string[] {
  const results: string[] = [];
  for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    const attrs = m[1] ?? '';
    const body = m[2] ?? '';
    if (!/\bsrc\s*=/.test(attrs) && body.trim().length > 0) {
      results.push(body);
    }
  }
  return results;
}

const namedCsps: readonly [name: string, csp: string][] = [
  ['index.html (meta)', webCsp()],
  ['vercel.json (header)', extractVercelHeaderValue(vercelJson, 'Content-Security-Policy')],
  ['public/_headers (Cloudflare)', extractHeadersFileValue(headersFile, 'Content-Security-Policy')],
  ['src-tauri/tauri.conf.json (Tauri WebView)', tauriCsp()],
  ...nginxCsps().map((csp, i) => [`nginx.conf (block ${i + 1})`, csp] as [string, string]),
];

describe('CSP correctness — Layer B (functional directives, not cross-surface consistency)', () => {
  it('nginx.conf has exactly 3 Content-Security-Policy add_header blocks', () => {
    expect(nginxCsps()).toHaveLength(3);
  });

  it('covers all 5 deployment surfaces (4 header/meta files + 3 nginx blocks = 7 CSP strings)', () => {
    expect(namedCsps).toHaveLength(7);
  });

  it.each(namedCsps)(
    "%s: script-src contains 'wasm-unsafe-eval' (WebLLM/ONNX Runtime Web/Transformers.js/DuckDB-WASM/Whisper-STT/Kokoro-TTS)",
    (_name, csp) => {
      const tokens = directiveTokens(csp, 'script-src');
      expect(tokens, 'script-src directive must exist').toBeDefined();
      expect(tokens).toContain("'wasm-unsafe-eval'");
    },
  );

  it.each(namedCsps)("%s: script-src does NOT contain 'unsafe-eval'", (_name, csp) => {
    const tokens = directiveTokens(csp, 'script-src') ?? [];
    expect(tokens).not.toContain("'unsafe-eval'");
  });

  it.each(namedCsps)("%s: script-src does NOT contain 'unsafe-inline'", (_name, csp) => {
    const tokens = directiveTokens(csp, 'script-src') ?? [];
    expect(tokens).not.toContain("'unsafe-inline'");
  });

  it.each(namedCsps)(
    '%s: frame-src (or child-src) allows blob: (Binder/ManuscriptResearchSplit PDF-preview iframes)',
    (_name, csp) => {
      const tokens = directiveTokens(csp, 'frame-src') ?? directiveTokens(csp, 'child-src');
      expect(tokens, 'frame-src or child-src directive must exist').toBeDefined();
      expect(tokens).toContain('blob:');
    },
  );

  it.each(namedCsps)(
    '%s: worker-src allows blob: (regression guard — DuckDB/inference workers)',
    (_name, csp) => {
      expect(directiveTokens(csp, 'worker-src')).toContain('blob:');
    },
  );

  it.each(namedCsps)('%s: img-src allows blob: (regression guard)', (_name, csp) => {
    expect(directiveTokens(csp, 'img-src')).toContain('blob:');
  });

  it.each(namedCsps)("%s: object-src is 'none'", (_name, csp) => {
    expect(directiveTokens(csp, 'object-src')).toEqual(["'none'"]);
  });

  it.each(namedCsps)("%s: base-uri is 'self'", (_name, csp) => {
    expect(directiveTokens(csp, 'base-uri')).toEqual(["'self'"]);
  });

  it.each(namedCsps)(
    "%s: frame-ancestors is 'none' (inert in the meta tag, effective as a header)",
    (_name, csp) => {
      expect(directiveTokens(csp, 'frame-ancestors')).toEqual(["'none'"]);
    },
  );
});

describe('CSP correctness — connect-src completeness (F-08)', () => {
  // QNBS-v3: LanguageTool's default self-hosted URL is `http://localhost:8010` — an HTTP origin,
  // which the web PWA's `https:` scheme-source does NOT cover either (different scheme). This was
  // missing on ALL 5 surfaces, not just Tauri as the source audit assumed (its "the web `https:`
  // masks the gap" reasoning only holds for HTTPS-reachable hosts). Fixed everywhere 2026-07-29.
  it.each(namedCsps)(
    '%s: allows LanguageTool default self-hosted port 8010 (features/settings/settingsSlice.ts:105)',
    (_name, csp) => {
      const tokens = directiveTokens(csp, 'connect-src') ?? [];
      expect(tokens).toContain('http://localhost:8010');
      expect(tokens).toContain('http://127.0.0.1:8010');
    },
  );

  // QNBS-v3: the web PWA's `connect-src 'self' https: ...` DOES implicitly cover these HTTPS hosts
  // (ADR-0004) — only the strict Tauri connect-src (no `https:` blanket) needs them enumerated.
  describe('Tauri-only: Hugging Face Hub hosts (no https: blanket to fall back on)', () => {
    const tauriConnectSrc = directiveTokens(tauriCsp(), 'connect-src') ?? [];

    it('allows the Hugging Face Hub host that WebLLM/Transformers.js resolve models from (their library defaults)', () => {
      expect(tauriConnectSrc).toContain('https://huggingface.co');
    });

    it('allows the Hugging Face Xet CDN bridge that actual model-weight downloads redirect to (empirically traced 2026-07-29: a resolve/main/*.bin request 302s to us.aws.cdn.hf.co)', () => {
      expect(tauriConnectSrc).toContain('https://us.aws.cdn.hf.co');
    });
  });
});

describe('CSP correctness — no ungehashtes (unhashed) inline <script> in index.html', () => {
  // QNBS-v3: this single assertion would have caught the 2026-05-27 defect (faad8f0) on day one —
  // an inline <script> was added in the same commit as `script-src 'self'` with no nonce/hash,
  // directly contradicting that commit's own CSP-strategy comment ("kein inline nötig").
  it('every inline <script> without a src has a matching sha256- hash in script-src, or none exist', () => {
    const inlineScripts = inlineScriptContents(webHtml);
    if (inlineScripts.length === 0) {
      expect(inlineScripts).toHaveLength(0);
      return;
    }
    const scriptSrcTokens = directiveTokens(webCsp(), 'script-src') ?? [];
    for (const content of inlineScripts) {
      expect(
        scriptSrcTokens.some((t) => t.startsWith("'sha256-")),
        `inline script "${content.trim().slice(0, 60)}…" needs a 'sha256-…' entry in script-src`,
      ).toBe(true);
    }
  });
});
