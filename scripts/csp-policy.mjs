import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// QNBS-v3: one data source keeps browser, headers, Tauri, runtime preflight, and tests aligned.
const policyPath = fileURLToPath(new URL('../config/csp-connect-src.json', import.meta.url));
const forbiddenSources = new Set(['*', 'https:', 'http:', 'ws:', 'wss:']);

export function validateCspConnectSrcPolicy(value) {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string' || forbiddenSources.has(entry))
  ) {
    throw new Error('config/csp-connect-src.json must contain explicit source strings');
  }
  return value;
}

// QNBS-v3: reject wildcard and scheme-only sources before one policy can widen every CSP surface.
const policy = validateCspConnectSrcPolicy(JSON.parse(readFileSync(policyPath, 'utf8')));

export const CSP_CONNECT_SRC = Object.freeze(policy);

export const CSP_CONNECT_SRC_DIRECTIVE = `connect-src ${CSP_CONNECT_SRC.join(' ')};`;
