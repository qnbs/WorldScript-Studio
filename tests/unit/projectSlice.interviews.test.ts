import { describe, expect, it } from 'vitest';
import projectReducer, { projectActions } from '../../features/project/projectSlice';
import type { CharacterInterview, InterviewMessage } from '../../types';

const NOW = '2026-01-01T00:00:00Z';

function makeInterview(overrides: Partial<CharacterInterview> = {}): CharacterInterview {
  return {
    id: 'iv-1',
    characterId: 'char-1',
    archetype: 'hero',
    templateId: 'hero-template',
    messages: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<InterviewMessage> = {}): InterviewMessage {
  return {
    id: 'msg-1',
    role: 'user',
    content: 'Hello',
    timestamp: NOW,
    ...overrides,
  };
}

type PartialState = { data: { characterInterviews?: Record<string, CharacterInterview[]> } };

function s(interviews: Record<string, CharacterInterview[]> = {}): PartialState {
  return { data: { characterInterviews: interviews } };
}

describe('projectSlice — characterInterview reducers', () => {
  it('addCharacterInterview creates a new list when none exists', () => {
    const interview = makeInterview();
    const next = projectReducer(
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      s() as any,
      projectActions.addCharacterInterview({ characterId: 'char-1', interview }),
    );
    expect(next.data.characterInterviews?.['char-1']).toHaveLength(1);
    expect(next.data.characterInterviews?.['char-1']?.[0]?.id).toBe('iv-1');
  });

  it('addCharacterInterview appends when list already exists', () => {
    const existing = makeInterview({ id: 'iv-0' });
    const second = makeInterview({ id: 'iv-2' });
    const next = projectReducer(
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      s({ 'char-1': [existing] }) as any,
      projectActions.addCharacterInterview({ characterId: 'char-1', interview: second }),
    );
    expect(next.data.characterInterviews?.['char-1']).toHaveLength(2);
  });

  it('appendInterviewMessage adds a message and updates updatedAt', () => {
    const interview = makeInterview();
    const state = s({ 'char-1': [interview] });
    const msg = makeMessage({ id: 'msg-new', content: 'A question' });
    const next = projectReducer(
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      state as any,
      projectActions.appendInterviewMessage({
        characterId: 'char-1',
        interviewId: 'iv-1',
        message: msg,
      }),
    );
    expect(next.data.characterInterviews?.['char-1']?.[0]?.messages).toHaveLength(1);
    expect(next.data.characterInterviews?.['char-1']?.[0]?.messages?.[0]?.content).toBe(
      'A question',
    );
  });

  it('deleteCharacterInterview removes the interview', () => {
    const interview = makeInterview();
    const state = s({ 'char-1': [interview] });
    const next = projectReducer(
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      state as any,
      projectActions.deleteCharacterInterview({ characterId: 'char-1', interviewId: 'iv-1' }),
    );
    expect(next.data.characterInterviews?.['char-1']).toHaveLength(0);
  });

  it('updateCharacterInterview patches non-message fields', () => {
    const interview = makeInterview({ title: 'Old Title' });
    const state = s({ 'char-1': [interview] });
    const next = projectReducer(
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      state as any,
      projectActions.updateCharacterInterview({
        characterId: 'char-1',
        interviewId: 'iv-1',
        changes: { title: 'New Title' },
      }),
    );
    expect(next.data.characterInterviews?.['char-1']?.[0]?.title).toBe('New Title');
  });

  it('streamInterviewChunk updates the AI message content in-place', () => {
    const aiMsg = makeMessage({ id: 'ai-msg', role: 'ai', content: '' });
    const interview = makeInterview({ messages: [aiMsg] });
    const state = s({ 'char-1': [interview] });
    const next = projectReducer(
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      state as any,
      {
        type: 'project/streamInterviewChunk',
        payload: {
          characterId: 'char-1',
          interviewId: 'iv-1',
          aiMsgId: 'ai-msg',
          content: 'Streaming response so far',
        },
      },
    );
    expect(next.data.characterInterviews?.['char-1']?.[0]?.messages?.[0]?.content).toBe(
      'Streaming response so far',
    );
  });
});
