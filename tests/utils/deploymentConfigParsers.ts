// QNBS-v3: Share one parser contract across the deployment-header regression tests instead of
// each test file duplicating its own group1/regex-extraction helpers.
/**
 * Shared parsing helpers for the deployment-surface regression tests (csp.test.ts,
 * deploymentHeaders.test.ts). Both suites read the same three host configs — vercel.json,
 * public/_headers, nginx.conf — and previously duplicated their own group1/regex-extraction
 * helpers; this is the single source of truth for "pull one header's value out of a host config".
 */

/** Extract capture group 1 with a narrowing guard (noUncheckedIndexedAccess-safe). */
export function group1(m: RegExpMatchArray | null, msg: string): string {
  if (!m || m[1] === undefined) throw new Error(msg);
  return m[1];
}

// QNBS-v3: headerName is only ever passed fixed string literals by the test files (never
// untrusted input), but escaping it before building a RegExp costs nothing and satisfies static
// analysis that otherwise can't verify that at every call site.
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Read a `Key: value` header from a Cloudflare-Pages-style `_headers` file (one directive per line). */
export function extractHeadersFileValue(source: string, headerName: string): string {
  const safeName = escapeRegExp(headerName);
  return group1(
    source.match(new RegExp(`${safeName}:\\s*([^\\n]*)`)),
    `${headerName} must exist in the _headers file`,
  ).trim();
}

/** Read a `add_header Key "value" ...;` directive from an nginx.conf-style file. */
export function extractNginxHeaderValue(source: string, headerName: string): string {
  const safeName = escapeRegExp(headerName);
  return group1(
    source.match(new RegExp(`add_header ${safeName} "([^"]*)"`)),
    `${headerName} must exist in nginx.conf`,
  ).trim();
}

/** Read a header value from a vercel.json-style `headers[]` array, by key (any source block). */
export function extractVercelHeaderValue(vercelJsonSource: string, headerKey: string): string {
  const conf = JSON.parse(vercelJsonSource) as {
    headers?: { source: string; headers: { key: string; value: string }[] }[];
  };
  for (const block of conf.headers ?? []) {
    const found = block.headers.find((h) => h.key === headerKey);
    if (found) return found.value;
  }
  throw new Error(`${headerKey} must exist in vercel.json's headers[]`);
}

/**
 * Parse a Permissions-Policy header value into a directive -> raw-allowlist-string map (last
 * occurrence wins, matching how a repeated directive would resolve). Lets callers assert the
 * exact value of a directive instead of `toContain`, which would also pass for a broader or
 * duplicated allowlist that merely contains the expected substring.
 */
export function parsePermissionsPolicy(value: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of value.split(',')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    map.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
  }
  return map;
}
