/**
 * Tests for features/project/thunks/interviewThunks.ts
 * QNBS-v3: Mocks geminiService + Redux; tests createNewInterview factory + streamInterviewResponseThunk.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockStreamText = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../services/geminiService', () => ({
  streamText: (...args: unknown[]) => mockStreamText(...args),
}));

vi.mock('../../../features/project/thunks/thunkUtils', () => ({
  buildAiCreativity: vi.fn(() => 0.7),
  buildAiOptions: vi.fn(() => ({ provider: 'gemini', model: 'gemini-2.5-flash' })),
}));

// UUID mock for deterministic IDs
vi.mock('uuid', () => ({
  v4: vi
    .fn()
    .mockReturnValueOnce('user-msg-id')
    .mockReturnValueOnce('ai-msg-id')
    .mockReturnValue('uuid-x'),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  createNewInterview,
  streamInterviewResponseThunk,
} from '../../../features/project/thunks/interviewThunks';
import type { CharacterArchetype, CharacterInterview } from '../../../types';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createNewInterview', () => {
  it('returns an interview with correct characterId and archetype', () => {
    const interview = createNewInterview(
      'char-1',
      'hero' as CharacterArchetype,
      'default-template',
    );
    expect(interview.characterId).toBe('char-1');
    expect(interview.archetype).toBe('hero');
  });

  it('returns an interview with the given templateId', () => {
    const interview = createNewInterview('char-1', 'hero' as CharacterArchetype, 'tpl-42');
    expect(interview.templateId).toBe('tpl-42');
  });

  it('returns an interview with empty messages array', () => {
    const interview = createNewInterview('char-1', 'hero' as CharacterArchetype, 'tpl-1');
    expect(interview.messages).toEqual([]);
  });

  it('includes title when provided', () => {
    const interview = createNewInterview(
      'char-1',
      'hero' as CharacterArchetype,
      'tpl-1',
      'First Interview',
    );
    expect(interview.title).toBe('First Interview');
  });

  it('does not include title property when not provided', () => {
    const interview = createNewInterview('char-1', 'hero' as CharacterArchetype, 'tpl-1');
    expect('title' in interview).toBe(false);
  });

  it('has valid ISO string timestamps', () => {
    const interview = createNewInterview('char-1', 'hero' as CharacterArchetype, 'tpl-1');
    expect(() => new Date(interview.createdAt)).not.toThrow();
    expect(() => new Date(interview.updatedAt)).not.toThrow();
  });

  it('returns a unique id on each call', () => {
    // UUID is mocked but we test the structure
    const interview = createNewInterview('char-1', 'hero' as CharacterArchetype, 'tpl-1');
    expect(typeof interview.id).toBe('string');
    expect(interview.id.length).toBeGreaterThan(0);
  });
});

describe('streamInterviewResponseThunk', () => {
  const CHARACTER = {
    id: 'char-1',
    name: 'Alice',
    backstory: 'A brave hero',
    motivation: 'Save the world',
    personalityTraits: 'Courageous',
  };

  const INTERVIEW: CharacterInterview = {
    id: 'interview-1',
    characterId: 'char-1',
    archetype: 'hero' as CharacterArchetype,
    templateId: 'tpl-1',
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  function makeState() {
    return {
      project: {
        present: {
          data: {
            characters: {
              ids: ['char-1'],
              entities: { 'char-1': CHARACTER },
            },
            characterInterviews: {
              'char-1': [INTERVIEW],
            },
          },
        },
      },
      settings: {
        present: {
          advancedAi: { provider: 'gemini', model: 'gemini-2.5-flash', temperature: 0.7 },
          aiCreativity: 'Balanced',
        },
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockStreamText.mockResolvedValue(undefined);
  });

  it('dispatches user message before AI response', async () => {
    const dispatch = vi.fn();
    const getState = vi.fn().mockReturnValue(makeState());
    const thunk = streamInterviewResponseThunk({
      characterId: 'char-1',
      interviewId: 'interview-1',
      question: 'What drives you?',
    });

    await thunk(dispatch, getState, undefined);

    // First dispatch call should be appendInterviewMessage with role 'user'
    const calls = dispatch.mock.calls;
    const userMsgCall = calls.find(
      (c) =>
        c[0]?.type === 'project/appendInterviewMessage' && c[0]?.payload?.message?.role === 'user',
    );
    expect(userMsgCall).toBeDefined();
    expect(userMsgCall![0].payload.message.content).toBe('What drives you?');
  });

  it('dispatches AI message placeholder after user message', async () => {
    const dispatch = vi.fn();
    const getState = vi.fn().mockReturnValue(makeState());
    const thunk = streamInterviewResponseThunk({
      characterId: 'char-1',
      interviewId: 'interview-1',
      question: 'Tell me about yourself',
    });

    await thunk(dispatch, getState, undefined);

    const aiMsgCall = dispatch.mock.calls.find(
      (c) =>
        c[0]?.type === 'project/appendInterviewMessage' && c[0]?.payload?.message?.role === 'ai',
    );
    expect(aiMsgCall).toBeDefined();
  });

  it('calls streamText with a prompt containing the character name', async () => {
    const dispatch = vi.fn();
    const getState = vi.fn().mockReturnValue(makeState());
    const thunk = streamInterviewResponseThunk({
      characterId: 'char-1',
      interviewId: 'interview-1',
      question: 'Who are you?',
    });

    await thunk(dispatch, getState, undefined);

    expect(mockStreamText).toHaveBeenCalledWith(
      expect.stringContaining('Alice'),
      expect.any(Number),
      expect.any(Function),
      expect.anything(),
    );
  });

  it('returns rejected action when character is not found in state', async () => {
    const state = makeState();
    // biome-ignore lint/suspicious/noExplicitAny: test mock — empty entity map
    state.project.present.data.characters = { ids: [], entities: {} as any };
    const dispatch = vi.fn();
    const getState = vi.fn().mockReturnValue(state);
    const thunk = streamInterviewResponseThunk({
      characterId: 'char-1',
      interviewId: 'interview-1',
      question: 'Hello?',
    });

    // QNBS-v3: createAsyncThunk catches throws and resolves with a rejected action (not re-throws)
    const result = await thunk(dispatch, getState, undefined);
    expect((result as { type: string }).type).toBe('project/streamInterviewResponse/rejected');
    expect((result as { error: { message: string } }).error.message).toContain('char-1');
  });

  it('returns rejected action when interview is not found in state', async () => {
    const state = makeState();
    state.project.present.data.characterInterviews = { 'char-1': [] };
    const dispatch = vi.fn();
    const getState = vi.fn().mockReturnValue(state);
    const thunk = streamInterviewResponseThunk({
      characterId: 'char-1',
      interviewId: 'interview-1',
      question: 'Hello?',
    });

    const result = await thunk(dispatch, getState, undefined);
    expect((result as { type: string }).type).toBe('project/streamInterviewResponse/rejected');
    expect((result as { error: { message: string } }).error.message).toContain('interview-1');
  });
});
