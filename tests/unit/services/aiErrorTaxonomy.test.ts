/**
 * Tests for services/ai/aiErrorTaxonomy.ts
 * QNBS-v3: Table-driven classification across every category + the offline short-circuit.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  type AiErrorCategory,
  classifyAiError,
  getAiErrorMessage,
} from '../../../services/ai/aiErrorTaxonomy';

interface Case {
  readonly name: string;
  readonly err: unknown;
  readonly category: AiErrorCategory;
  readonly retryable: boolean;
}

const CASES: readonly Case[] = [
  // --- by HTTP status -------------------------------------------------------
  { name: '429 status', err: { status: 429 }, category: 'rateLimit', retryable: true },
  { name: '401 status', err: { status: 401 }, category: 'auth', retryable: false },
  { name: '403 status', err: { status: 403 }, category: 'auth', retryable: false },
  { name: '408 status', err: { status: 408 }, category: 'transient', retryable: true },
  { name: '400 status', err: { status: 400 }, category: 'invalidRequest', retryable: false },
  { name: '404 status', err: { status: 404 }, category: 'invalidRequest', retryable: false },
  { name: '422 status', err: { status: 422 }, category: 'invalidRequest', retryable: false },
  { name: '500 status', err: { status: 500 }, category: 'transient', retryable: true },
  { name: '503 status', err: { status: 503 }, category: 'transient', retryable: true },
  { name: 'statusCode field', err: { statusCode: 401 }, category: 'auth', retryable: false },
  {
    name: 'nested response.status',
    err: { response: { status: 429 } },
    category: 'rateLimit',
    retryable: true,
  },
  // --- by message markers ---------------------------------------------------
  {
    name: 'policy: local-only block',
    err: new Error('Cloud provider blocked: local-only mode is active.'),
    category: 'policy',
    retryable: false,
  },
  {
    name: 'policy: LoRA training block',
    err: new Error('LoRA training blocked: model "openai/x" appears to be cloud-hosted.'),
    category: 'policy',
    retryable: false,
  },
  {
    name: 'rate limit message',
    err: new Error('Rate limit exceeded, try again later'),
    category: 'rateLimit',
    retryable: true,
  },
  {
    name: 'unauthorized message',
    err: new Error('Unauthorized'),
    category: 'auth',
    retryable: false,
  },
  {
    name: 'invalid api key message',
    err: new Error('Invalid API key provided'),
    category: 'auth',
    retryable: false,
  },
  {
    name: 'timeout message',
    err: new Error('Request timed out'),
    category: 'transient',
    retryable: true,
  },
  {
    name: 'socket hang up message',
    err: new Error('socket hang up'),
    category: 'transient',
    retryable: true,
  },
  {
    name: 'failed to fetch message',
    err: new Error('Failed to fetch'),
    category: 'network',
    retryable: true,
  },
  {
    name: 'ENOTFOUND message',
    err: new Error('getaddrinfo ENOTFOUND api.example.invalid'),
    category: 'network',
    retryable: true,
  },
  {
    name: 'fetch TypeError',
    err: new TypeError('NetworkError when attempting to fetch resource'),
    category: 'network',
    retryable: true,
  },
  // --- cancellation (must fail fast, never retry) ---------------------------
  {
    name: 'AbortError by name',
    err: Object.assign(new Error('signal aborted without reason'), { name: 'AbortError' }),
    category: 'canceled',
    retryable: false,
  },
  {
    name: 'DOMException abort code 20',
    err: { code: 20, message: 'aborted' },
    category: 'canceled',
    retryable: false,
  },
  {
    name: 'operation was aborted message',
    err: new Error('The operation was aborted'),
    category: 'canceled',
    retryable: false,
  },
  {
    name: 'cancelled message',
    err: new Error('Request cancelled by user'),
    category: 'canceled',
    retryable: false,
  },
  // --- conservative defaults ------------------------------------------------
  {
    name: 'unknown Error → transient',
    err: new Error('something weird happened'),
    category: 'transient',
    retryable: true,
  },
  { name: 'bare string → transient', err: 'boom', category: 'transient', retryable: true },
  { name: 'null → transient', err: null, category: 'transient', retryable: true },
];

describe('classifyAiError', () => {
  for (const c of CASES) {
    it(`classifies ${c.name} as ${c.category} (retryable=${c.retryable})`, () => {
      const result = classifyAiError(c.err);
      expect(result.category).toBe(c.category);
      expect(result.retryable).toBe(c.retryable);
      expect(result.messageKey).toBe(`error.ai.${c.category}`);
    });
  }

  it('status takes precedence over a misleading message', () => {
    // 401 status with a generic message must classify as auth, not transient.
    const result = classifyAiError({ status: 401, message: 'temporary glitch' });
    expect(result.category).toBe('auth');
    expect(result.retryable).toBe(false);
  });

  describe('offline short-circuit', () => {
    afterEach(() => {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    });

    it('returns offline (non-retryable) when navigator is offline, even for a 429', () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      const result = classifyAiError({ status: 429 });
      expect(result.category).toBe('offline');
      expect(result.retryable).toBe(false);
      expect(result.messageKey).toBe('error.ai.offline');
    });
  });
});

describe('getAiErrorMessage', () => {
  const t = (key: string): string => `t:${key}`;

  it('resolves a classified error to its error.ai.* message via t', () => {
    expect(getAiErrorMessage({ status: 401 }, t)).toBe('t:error.ai.auth');
    expect(getAiErrorMessage(new Error('Cloud provider blocked: local-only mode'), t)).toBe(
      't:error.ai.policy',
    );
    expect(getAiErrorMessage(new Error('socket hang up'), t)).toBe('t:error.ai.transient');
  });
});
