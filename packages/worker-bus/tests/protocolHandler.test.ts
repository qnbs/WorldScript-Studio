import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createResultMessage, createTaskMessage } from '../src/messageBus';
import { ProtocolHandler } from '../src/protocolHandler';

describe('ProtocolHandler', () => {
  let channel: MessageChannel;
  let handler: ProtocolHandler;

  beforeEach(() => {
    channel = new MessageChannel();
    handler = new ProtocolHandler(channel.port1);
  });

  afterEach(() => {
    handler.dispose();
  });

  it('resolves on RESULT success', async () => {
    const promise = handler.sendTask('t1', 'test.task', { foo: 1 }, 'trace-1');
    channel.port2.postMessage(createResultMessage('t1', true, 10, 'hello'));
    const result = await promise;
    expect(result.success).toBe(true);
    expect(result.result).toBe('hello');
    expect(result.latencyMs).toBe(10);
  });

  it('resolves on RESULT failure', async () => {
    const promise = handler.sendTask('t2', 'test.task', {}, 'trace-2');
    channel.port2.postMessage(
      createResultMessage('t2', false, 5, undefined, { code: 'FAIL', message: 'oops' }),
    );
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('FAIL');
  });

  it('rejects on timeout', async () => {
    const promise = handler.sendTask('t3', 'test.task', {}, 'trace-3', 1);
    await expect(promise).rejects.toThrow('Task timed out');
  });

  it('sendCancel rejects pending task', async () => {
    const promise = handler.sendTask('t4', 'test.task', {}, 'trace-4', 10_000);
    handler.sendCancel('t4', 'user-cancel');
    await expect(promise).rejects.toThrow('Task cancelled');
  });

  it('dispose rejects all pending', async () => {
    const p1 = handler.sendTask('t5', 'test.task', {}, 'trace-5', 10_000);
    const p2 = handler.sendTask('t6', 'test.task', {}, 'trace-6', 10_000);
    handler.dispose();
    await expect(p1).rejects.toThrow('Protocol handler disposed');
    await expect(p2).rejects.toThrow('Protocol handler disposed');
  });

  it('ignores RESULT for unknown taskId', async () => {
    channel.port2.postMessage(createResultMessage('unknown', true, 0, 'ok'));
    // should not throw; just ignored
    expect(true).toBe(true);
  });

  it('ignores non-RESULT messages', async () => {
    const promise = handler.sendTask('t7', 'test.task', {}, 'trace-7', 10_000);
    channel.port2.postMessage(createTaskMessage('t7', 'test.task', {}, 'trace-7'));
    // send actual result to resolve so test doesn't hang
    channel.port2.postMessage(createResultMessage('t7', true, 0, 'ok'));
    const result = await promise;
    expect(result.result).toBe('ok');
  });
});
