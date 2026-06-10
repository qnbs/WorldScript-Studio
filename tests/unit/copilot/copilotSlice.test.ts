import { describe, expect, it } from 'vitest';
import reducer, { type CopilotState, copilotActions } from '../../../features/copilot/copilotSlice';

function initial(): CopilotState {
  return reducer(undefined, { type: '@@INIT' });
}

describe('copilotSlice', () => {
  it('starts closed, empty, idle', () => {
    const s = initial();
    expect(s.isOpen).toBe(false);
    expect(s.messages).toEqual([]);
    expect(s.status).toBe('idle');
  });

  it('setOpen and toggle control visibility', () => {
    let s = reducer(initial(), copilotActions.setOpen(true));
    expect(s.isOpen).toBe(true);
    s = reducer(s, copilotActions.toggle());
    expect(s.isOpen).toBe(false);
  });

  it('addMessage appends with id/role/content', () => {
    const s = reducer(initial(), copilotActions.addMessage('user', 'hello'));
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]?.role).toBe('user');
    expect(s.messages[0]?.content).toBe('hello');
    expect(s.messages[0]?.id).toBeTruthy();
  });

  it('setLastAssistantContent updates only the latest assistant message', () => {
    let s = reducer(initial(), copilotActions.addMessage('user', 'q'));
    s = reducer(s, copilotActions.addMessage('assistant', '', true));
    s = reducer(s, copilotActions.setLastAssistantContent('streamed answer'));
    expect(s.messages[1]?.content).toBe('streamed answer');
    expect(s.messages[1]?.pending).toBe(true);
    s = reducer(s, copilotActions.finishLastAssistant());
    expect(s.messages[1]?.pending).toBeUndefined();
  });

  it('setError sets error and status=error', () => {
    const s = reducer(initial(), copilotActions.setError('boom'));
    expect(s.error).toBe('boom');
    expect(s.status).toBe('error');
  });

  it('clear resets messages, status, error', () => {
    let s = reducer(initial(), copilotActions.addMessage('user', 'x'));
    s = reducer(s, copilotActions.setError('e'));
    s = reducer(s, copilotActions.clear());
    expect(s.messages).toEqual([]);
    expect(s.status).toBe('idle');
    expect(s.error).toBeNull();
  });
});
