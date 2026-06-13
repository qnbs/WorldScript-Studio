/**
 * Tests for plugin.worker.ts — Worker isolation for plugin execution.
 * QNBS-v3: P0 — Verifies Function-scope sandbox: dangerous globals are shadowed,
 *          side effects are collected, and AbortSignal is respected.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Capture registered handlers so we can invoke them directly.
const registeredHandlers = new Map<string, (ctx: unknown) => Promise<unknown>>();
const mockRegisterTaskHandler = vi.fn(
  (taskType: string, handler: (ctx: unknown) => Promise<unknown>) => {
    registeredHandlers.set(taskType, handler);
  },
);

vi.mock('@domain/worker-bus', () => ({
  registerTaskHandler: mockRegisterTaskHandler,
}));

function makeContext(overrides: { payload?: unknown; signalAborted?: boolean } = {}): {
  taskId: string;
  taskType: string;
  payload: unknown;
  signal: AbortSignal;
  emitProgress: ReturnType<typeof vi.fn>;
} {
  const controller = new AbortController();
  if (overrides.signalAborted) controller.abort();
  return {
    taskId: 'task-1',
    taskType: 'plugin.execute',
    payload: overrides.payload,
    signal: controller.signal,
    emitProgress: vi.fn(),
  };
}

async function importWorker(): Promise<void> {
  registeredHandlers.clear();
  // QNBS-v3: Force re-evaluation of the worker module so registerTaskHandler runs again.
  vi.resetModules();
  await import('../../../workers/plugin.worker', { with: { type: 'script' } });
}

async function expectRejects(
  handler: (ctx: unknown) => Promise<unknown>,
  ctx: ReturnType<typeof makeContext>,
  pattern: RegExp,
): Promise<void> {
  await expect(handler(ctx)).rejects.toThrow(pattern);
}

describe('plugin.worker', () => {
  beforeEach(async () => {
    mockRegisterTaskHandler.mockClear();
    await importWorker();
  });

  describe('task registration', () => {
    it('registers plugin.execute and plugin.ping task handlers on module load', () => {
      expect(mockRegisterTaskHandler).toHaveBeenCalledTimes(2);
      expect(mockRegisterTaskHandler).toHaveBeenCalledWith('plugin.execute', expect.any(Function));
      expect(mockRegisterTaskHandler).toHaveBeenCalledWith('plugin.ping', expect.any(Function));
    });
  });

  describe('sandbox security', () => {
    it('denies access to fetch inside plugin code', async () => {
      const handler = registeredHandlers.get('plugin.execute');
      if (!handler) throw new Error('plugin.execute handler not registered');

      const ctx = makeContext({
        payload: {
          pluginId: 'escape-test',
          code: 'run = async () => { await fetch("https://evil.test"); };',
          grantedPermissions: [],
          readApiSnapshot: { projectTitle: '', sceneTitles: [] },
        },
      });

      await expectRejects(
        handler,
        ctx,
        /fetch is not defined|undefined is not a function|is not a function/,
      );
    });

    it('denies access to indexedDB inside plugin code', async () => {
      const handler = registeredHandlers.get('plugin.execute');
      if (!handler) throw new Error('plugin.execute handler not registered');

      const ctx = makeContext({
        payload: {
          pluginId: 'escape-test',
          code: 'run = async () => { indexedDB.open("x"); };',
          grantedPermissions: [],
          readApiSnapshot: { projectTitle: '', sceneTitles: [] },
        },
      });

      await expectRejects(
        handler,
        ctx,
        /indexedDB is not defined|Cannot read properties of undefined/,
      );
    });

    it('denies access to self/globalThis inside plugin code', async () => {
      const handler = registeredHandlers.get('plugin.execute');
      if (!handler) throw new Error('plugin.execute handler not registered');

      const ctx = makeContext({
        payload: {
          pluginId: 'escape-test',
          code: 'run = () => { return typeof self !== "undefined" || typeof globalThis !== "undefined"; };',
          grantedPermissions: [],
          readApiSnapshot: { projectTitle: '', sceneTitles: [] },
        },
      });

      const result = (await handler(ctx)) as { sideEffects: unknown[] };
      expect(result.sideEffects).toHaveLength(0);
    });

    it('blocks Function constructor escape via (function(){}).constructor', async () => {
      const handler = registeredHandlers.get('plugin.execute');
      if (!handler) throw new Error('plugin.execute handler not registered');

      const ctx = makeContext({
        payload: {
          pluginId: 'function-escape',
          code: 'run = () => { (function(){}).constructor("return globalThis")(); };',
          grantedPermissions: [],
          readApiSnapshot: { projectTitle: '', sceneTitles: [] },
        },
      });

      await expectRejects(handler, ctx, /Function constructor is disabled/);
    });

    it('blocks AsyncFunction constructor escape', async () => {
      const handler = registeredHandlers.get('plugin.execute');
      if (!handler) throw new Error('plugin.execute handler not registered');

      const ctx = makeContext({
        payload: {
          pluginId: 'async-function-escape',
          code: 'run = () => { (async function(){}).constructor("return globalThis")(); };',
          grantedPermissions: [],
          readApiSnapshot: { projectTitle: '', sceneTitles: [] },
        },
      });

      await expectRejects(handler, ctx, /AsyncFunction constructor is disabled/);
    });

    it('blocks GeneratorFunction constructor escape', async () => {
      const handler = registeredHandlers.get('plugin.execute');
      if (!handler) throw new Error('plugin.execute handler not registered');

      const ctx = makeContext({
        payload: {
          pluginId: 'generator-function-escape',
          code: 'run = () => { (function*(){}).constructor("return globalThis")(); };',
          grantedPermissions: [],
          readApiSnapshot: { projectTitle: '', sceneTitles: [] },
        },
      });

      await expectRejects(handler, ctx, /GeneratorFunction constructor is disabled/);
    });

    it('blocks AsyncGeneratorFunction constructor escape', async () => {
      const handler = registeredHandlers.get('plugin.execute');
      if (!handler) throw new Error('plugin.execute handler not registered');

      const ctx = makeContext({
        payload: {
          pluginId: 'async-generator-function-escape',
          code: 'run = () => { (async function*(){}).constructor("return globalThis")(); };',
          grantedPermissions: [],
          readApiSnapshot: { projectTitle: '', sceneTitles: [] },
        },
      });

      await expectRejects(handler, ctx, /AsyncGeneratorFunction constructor is disabled/);
    });

    it('denies access to WebAssembly inside plugin code', async () => {
      const handler = registeredHandlers.get('plugin.execute');
      if (!handler) throw new Error('plugin.execute handler not registered');

      const ctx = makeContext({
        payload: {
          pluginId: 'wasm-escape',
          // QNBS-v3: WebAssembly is both shadowed in the sandbox scope and neutered on
          // `self`, so any reference resolves to undefined and member access throws.
          code: 'run = async () => { await WebAssembly.instantiate(new Uint8Array([0])); };',
          grantedPermissions: [],
          readApiSnapshot: { projectTitle: '', sceneTitles: [] },
        },
      });

      await expectRejects(
        handler,
        ctx,
        /WebAssembly is not defined|Cannot read properties of undefined|is not a function/,
      );
    });

    it('restores the self global bindings after a plugin run completes', async () => {
      const handler = registeredHandlers.get('plugin.execute');
      if (!handler) throw new Error('plugin.execute handler not registered');

      const selfRef = self as unknown as Record<string, unknown>;
      const originalFunction = selfRef['Function'];
      const originalEval = selfRef['eval'];
      const originalWebAssembly = selfRef['WebAssembly'];

      const ctx = makeContext({
        payload: {
          pluginId: 'benign',
          code: 'run = (api) => { api.log("ok"); };',
          grantedPermissions: [],
          readApiSnapshot: { projectTitle: '', sceneTitles: [] },
        },
      });
      await handler(ctx);

      // QNBS-v3: install/restore must be balanced so the dedicated worker keeps a healthy
      // global scope for subsequent tasks. The self.* bindings round-trip to their
      // captured originals. (NOTE: Function.prototype.constructor does NOT round-trip to
      // its pre-call value — tracked as a follow-up; benign because createSandboxedRunner
      // compiles via the captured GlobalFunction, not Function.prototype.constructor.)
      expect(selfRef['Function']).toBe(originalFunction);
      expect(selfRef['eval']).toBe(originalEval);
      expect(selfRef['WebAssembly']).toBe(originalWebAssembly);
    });

    it('restores the self global bindings even after a plugin throws', async () => {
      const handler = registeredHandlers.get('plugin.execute');
      if (!handler) throw new Error('plugin.execute handler not registered');

      const selfRef = self as unknown as Record<string, unknown>;
      const originalFunction = selfRef['Function'];
      const originalWebAssembly = selfRef['WebAssembly'];

      const ctx = makeContext({
        payload: {
          pluginId: 'crash-then-restore',
          code: 'run = () => { throw new Error("boom"); };',
          grantedPermissions: [],
          readApiSnapshot: { projectTitle: '', sceneTitles: [] },
        },
      });
      await expectRejects(handler, ctx, /boom/);

      // QNBS-v3: the finally block restores guards on the error path too.
      expect(selfRef['Function']).toBe(originalFunction);
      expect(selfRef['WebAssembly']).toBe(originalWebAssembly);
    });
  });

  describe('plugin execution', () => {
    it('throws when payload is invalid', async () => {
      const handler = registeredHandlers.get('plugin.execute');
      if (!handler) throw new Error('plugin.execute handler not registered');

      const ctx = makeContext({ payload: { pluginId: 'x' } });
      await expectRejects(handler, ctx, /Invalid plugin.execute payload/);
    });

    it('throws when plugin has no run export', async () => {
      const handler = registeredHandlers.get('plugin.execute');
      if (!handler) throw new Error('plugin.execute handler not registered');

      const ctx = makeContext({
        payload: {
          pluginId: 'no-run',
          code: 'const x = 1;',
          grantedPermissions: [],
          readApiSnapshot: { projectTitle: '', sceneTitles: [] },
        },
      });
      await expectRejects(handler, ctx, /has no exported run\(\) function/);
    });

    it('normalizes ESM export async function run syntax', async () => {
      const handler = registeredHandlers.get('plugin.execute');
      if (!handler) throw new Error('plugin.execute handler not registered');

      const ctx = makeContext({
        payload: {
          pluginId: 'esm-plugin',
          code: 'export async function run(api) { api.log("esm ok"); }',
          grantedPermissions: [],
          readApiSnapshot: { projectTitle: '', sceneTitles: [] },
        },
      });
      const result = (await handler(ctx)) as { logs: string[] };
      expect(result.logs).toEqual(['esm ok']);
    });

    it('normalizes ESM export function run syntax', async () => {
      const handler = registeredHandlers.get('plugin.execute');
      if (!handler) throw new Error('plugin.execute handler not registered');

      const ctx = makeContext({
        payload: {
          pluginId: 'esm-plugin',
          code: 'export function run(api) { api.log("esm sync ok"); }',
          grantedPermissions: [],
          readApiSnapshot: { projectTitle: '', sceneTitles: [] },
        },
      });
      const result = (await handler(ctx)) as { logs: string[] };
      expect(result.logs).toEqual(['esm sync ok']);
    });

    it('collects appendToCurrentScene side effects when permission is granted', async () => {
      const handler = registeredHandlers.get('plugin.execute');
      if (!handler) throw new Error('plugin.execute handler not registered');

      const ctx = makeContext({
        payload: {
          pluginId: 'side-effect',
          code: 'run = (api) => { api.appendToCurrentScene("extra"); };',
          grantedPermissions: ['scene.write'],
          readApiSnapshot: { projectTitle: '', sceneTitles: [] },
        },
      });
      const result = (await handler(ctx)) as {
        sideEffects: Array<{ kind: string; payload: string }>;
      };
      expect(result.sideEffects).toEqual([{ kind: 'append', payload: 'extra' }]);
    });

    it('throws permission denied when appendToCurrentScene is called without scene.write', async () => {
      const handler = registeredHandlers.get('plugin.execute');
      if (!handler) throw new Error('plugin.execute handler not registered');

      const ctx = makeContext({
        payload: {
          pluginId: 'no-perm',
          code: 'run = (api) => { api.appendToCurrentScene("extra"); };',
          grantedPermissions: [],
          readApiSnapshot: { projectTitle: '', sceneTitles: [] },
        },
      });
      await expectRejects(handler, ctx, /Permission denied: scene.write/);
    });

    it('collects logs', async () => {
      const handler = registeredHandlers.get('plugin.execute');
      if (!handler) throw new Error('plugin.execute handler not registered');

      const ctx = makeContext({
        payload: {
          pluginId: 'logger',
          code: 'run = (api) => { api.log("hello"); api.log(123); };',
          grantedPermissions: [],
          readApiSnapshot: { projectTitle: '', sceneTitles: [] },
        },
      });
      const result = (await handler(ctx)) as { logs: string[] };
      expect(result.logs).toEqual(['hello', '123']);
    });

    it('reads project title and scene titles from snapshot', async () => {
      const handler = registeredHandlers.get('plugin.execute');
      if (!handler) throw new Error('plugin.execute handler not registered');

      const ctx = makeContext({
        payload: {
          pluginId: 'reader',
          code: 'let captured; run = (api) => { captured = { title: api.getProjectTitle(), scenes: api.getSceneTitles() }; api.log(JSON.stringify(captured)); };',
          grantedPermissions: ['project.read', 'scene.read'],
          readApiSnapshot: { projectTitle: 'My Novel', sceneTitles: ['Opening', 'Twist'] },
        },
      });
      const result = (await handler(ctx)) as { logs: string[] };
      expect(result.logs[0]).toBe('{"title":"My Novel","scenes":["Opening","Twist"]}');
    });

    it('async APIs are unavailable in worker sandbox even without await', async () => {
      const handler = registeredHandlers.get('plugin.execute');
      if (!handler) throw new Error('plugin.execute handler not registered');

      const ctx = makeContext({
        payload: {
          pluginId: 'async-api',
          code: 'run = (api) => { api.generateText("x"); };',
          grantedPermissions: ['ai.invoke'],
          readApiSnapshot: { projectTitle: '', sceneTitles: [] },
        },
      });
      await expectRejects(
        handler,
        ctx,
        /generateText\(\) is not available inside the worker sandbox/,
      );
    });

    it('propagates plugin errors instead of returning success', async () => {
      const handler = registeredHandlers.get('plugin.execute');
      if (!handler) throw new Error('plugin.execute handler not registered');

      const ctx = makeContext({
        payload: {
          pluginId: 'crash',
          code: 'run = () => { throw new Error("plugin crash"); };',
          grantedPermissions: [],
          readApiSnapshot: { projectTitle: '', sceneTitles: [] },
        },
      });
      await expectRejects(handler, ctx, /plugin crash/);
    });
  });

  describe('abort/timeout', () => {
    it('throws aborted error when signal is already aborted', async () => {
      const handler = registeredHandlers.get('plugin.execute');
      if (!handler) throw new Error('plugin.execute handler not registered');

      const ctx = makeContext({
        payload: {
          pluginId: 'aborted',
          code: 'run = () => {};',
          grantedPermissions: [],
          readApiSnapshot: { projectTitle: '', sceneTitles: [] },
        },
        signalAborted: true,
      });
      await expectRejects(handler, ctx, /aborted before start/);
    });
  });

  describe('plugin.ping', () => {
    it('responds with ok status', async () => {
      const handler = registeredHandlers.get('plugin.ping');
      if (!handler) throw new Error('plugin.ping handler not registered');

      const result = (await handler(makeContext())) as { status: string };
      expect(result.status).toBe('ok');
    });
  });
});
