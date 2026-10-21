/**
 * LanguageTool nur gegen konfigurierte Basis-URL (lokal empfohlen).
 * QNBS-v3 (#818): LanguageTool is off by default and points at localhost. A remote server is used
 * only when the user enables it and enters that URL, the CSP connect-src allowlist admits it, and
 * the AI execution mode is not local-only (local/eco) — the mode that also carries a migrated
 * "Local storage only" choice, so previously blocked remote checks stay blocked.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

import type { Settings } from '../types';
import { assertCspConnectEndpointAllowed } from './network/cspOriginPolicy';

export function assertLanguageToolAllowed(settings: Settings, baseUrl: string): void {
  if (!settings.integrations.languageToolEnabled) {
    throw new Error('LanguageTool is disabled in settings.');
  }
  assertCspConnectEndpointAllowed(baseUrl, 'LanguageTool endpoint');
  let host = '';
  try {
    host = new URL(baseUrl.trim()).hostname;
  } catch {
    throw new Error('Invalid LanguageTool base URL.');
  }
  const localOnlyMode = settings.aiMode === 'local' || settings.aiMode === 'eco';
  if (localOnlyMode && !LOCAL_HOSTS.has(host)) {
    throw new Error('Remote LanguageTool is blocked while the AI execution mode is local-only.');
  }
}

/** Minimaler Check (POST /v2/check) — kein Text wird protokolliert. */
export async function languageToolPing(
  baseUrl: string,
  sampleText = 'Hello world.',
): Promise<boolean> {
  // QNBS-v3: validate the ping target before putting sample text on the network.
  const allowedBaseUrl = assertCspConnectEndpointAllowed(baseUrl, 'LanguageTool endpoint');
  const url = `${allowedBaseUrl.toString().replace(/\/+$/, '')}/v2/check`;
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
