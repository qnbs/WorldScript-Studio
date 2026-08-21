import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// QNBS-v3: one data source keeps browser, headers, Tauri, runtime preflight, and tests aligned.
const policyPath = fileURLToPath(new URL('../config/csp-connect-src.json', import.meta.url));
const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
if (!Array.isArray(policy) || policy.some((entry) => typeof entry !== 'string')) {
  throw new Error('config/csp-connect-src.json must contain a string array');
}

export const CSP_CONNECT_SRC = Object.freeze(policy);

export const CSP_CONNECT_SRC_DIRECTIVE = `connect-src ${CSP_CONNECT_SRC.join(' ')};`;
