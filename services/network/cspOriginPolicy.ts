import cspConnectSrc from '../../config/csp-connect-src.json';

const allowedOrigins = new Set(
  cspConnectSrc.filter((source): source is string => source !== "'self'"),
);

export class CspConnectPolicyError extends Error {
  readonly code = 'CSP_CONNECT_ORIGIN_BLOCKED';

  constructor(label: string, reason: 'invalid' | 'unsupported') {
    super(
      reason === 'invalid'
        ? `${label} URL is invalid. Enter a complete http(s) URL.`
        : `${label} origin is blocked by the current browser CSP network policy. Use a supported origin or request an explicit policy update before using this endpoint.`,
    );
    this.name = 'CspConnectPolicyError';
  }
}

/** Validates a configured endpoint against the same origin set emitted into CSP. */
export function assertCspConnectEndpointAllowed(endpoint: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(endpoint.trim());
  } catch {
    throw new CspConnectPolicyError(label, 'invalid');
  }

  // QNBS-v3: runtime checks must match emitted CSP so configured endpoints cannot widen egress.
  if (url.username !== '' || url.password !== '' || !allowedOrigins.has(url.origin)) {
    throw new CspConnectPolicyError(label, 'unsupported');
  }
  return url;
}

export function isCspConnectEndpointAllowed(endpoint: string): boolean {
  try {
    assertCspConnectEndpointAllowed(endpoint, 'Endpoint');
    return true;
  } catch {
    return false;
  }
}
