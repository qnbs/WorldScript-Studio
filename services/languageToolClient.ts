/**
 * LanguageTool nur gegen konfigurierte Basis-URL (lokal empfohlen).
 * QNBS-v3: Privacy-Gating — remote Server bei local-only blockieren.
 */

import type { Settings } from '../types';

export function assertLanguageToolAllowed(settings: Settings, baseUrl: string): void {
  if (!settings.integrations.languageToolEnabled) {
    throw new Error('LanguageTool is disabled in settings.');
  }
  let host = '';
  try {
    host = new URL(baseUrl.trim()).hostname;
  } catch {
    throw new Error('Invalid LanguageTool base URL.');
  }
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  if (settings.privacy.localStorageOnly && !isLocal) {
    throw new Error('Remote LanguageTool is blocked while local-only privacy mode is on.');
  }
}

/** Minimaler Check (POST /v2/check) — kein Text wird protokolliert. */
export async function languageToolPing(
  baseUrl: string,
  sampleText = 'Hello world.',
): Promise<boolean> {
  const url = `${baseUrl.replace(/\/+$/, '')}/v2/check`;
  const body = new URLSearchParams();
  body.set('text', sampleText.slice(0, 400));
  body.set('language', 'en-US');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(8000) as AbortSignal,
  });
  return res.ok;
}
