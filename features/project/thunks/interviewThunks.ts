import { createAsyncThunk } from '@reduxjs/toolkit';
import { v4 as uuidv4 } from 'uuid';
import type { RootState } from '../../../app/store';
import { streamText } from '../../../services/geminiService';
import type { CharacterArchetype, CharacterInterview, InterviewMessage } from '../../../types';
import {
  assertProjectIdentityUnchanged,
  getProjectTargetIdentity,
  identityUnchanged,
  StaleProjectOperationError,
} from '../projectIdentity';
import { selectAllCharacters } from '../projectSelectors';
import { projectActions } from '../projectSlice';
import { buildAiCreativity, buildAiOptions } from './thunkUtils';

// QNBS-v3: persona prompt builds character voice from Redux state to avoid re-fetching
function buildInterviewPersonaPrompt(params: {
  characterName: string;
  archetype: CharacterArchetype;
  backstory: string;
  motivation: string;
  personalityTraits: string;
  recentMessages: InterviewMessage[];
  question: string;
}): string {
  const {
    characterName,
    archetype,
    backstory,
    motivation,
    personalityTraits,
    recentMessages,
    question,
  } = params;

  const history = recentMessages
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'Interviewer' : characterName}: ${m.content}`)
    .join('\n');

  return `You are ${characterName}, a ${archetype} character.

Your backstory: ${backstory || 'Not specified.'}
Your motivation: ${motivation || 'Not specified.'}
Your personality: ${personalityTraits || 'Not specified.'}

${history ? `Previous conversation:\n${history}\n\n` : ''}Interviewer asks: "${question}"

Respond in first person as ${characterName}, in character. Keep your answer to 2–4 paragraphs. Stay true to your backstory, motivation, and personality. Do not break character or speak as the author.`;
}

export const streamInterviewResponseThunk = createAsyncThunk(
  'project/streamInterviewResponse',
  async (
    params: {
      characterId: string;
      interviewId: string;
      question: string;
    },
    { getState, dispatch, signal },
  ) => {
    const state = getState() as RootState;
    const { characterId, interviewId, question } = params;
    const originIdentity = getProjectTargetIdentity(state.project.present);
    assertProjectIdentityUnchanged(
      originIdentity,
      getProjectTargetIdentity(state.project.present),
      'character interview start',
    );

    const characters = selectAllCharacters(state);
    const character = characters.find((c) => c.id === characterId);
    if (!character) throw new Error(`Character ${characterId} not found`);

    const interviews = state.project.present.data.characterInterviews?.[characterId] ?? [];
    const interview = interviews.find((iv) => iv.id === interviewId);
    if (!interview) throw new Error(`Interview ${interviewId} not found`);

    const creativity = buildAiCreativity(state);
    const aiOptions = buildAiOptions(state);

    // Add the user message immediately
    const userMsg: InterviewMessage = {
      id: uuidv4(),
      role: 'user',
      content: question,
      timestamp: new Date().toISOString(),
    };
    dispatch(projectActions.appendInterviewMessage({ characterId, interviewId, message: userMsg }));

    // Prepare the AI message placeholder (streamed chunks appended one at a time)
    const aiMsgId = uuidv4();
    const aiMsgTimestamp = new Date().toISOString();
    const aiMsgStart: InterviewMessage = {
      id: aiMsgId,
      role: 'ai',
      content: '',
      timestamp: aiMsgTimestamp,
    };
    dispatch(
      projectActions.appendInterviewMessage({ characterId, interviewId, message: aiMsgStart }),
    );

    const prompt = buildInterviewPersonaPrompt({
      characterName: character.name,
      archetype: interview.archetype,
      backstory: character.backstory,
      motivation: character.motivation,
      personalityTraits: character.personalityTraits,
      recentMessages: interview.messages,
      question,
    });

    let accumulated = '';
    let stale = false;
    await streamText(
      prompt,
      creativity,
      (chunk) => {
        if (stale) return;
        const liveIdentity = getProjectTargetIdentity((getState() as RootState).project.present);
        if (!identityUnchanged(originIdentity, liveIdentity)) {
          // QNBS-v3: stop accepting chunks as soon as the originating project incarnation is replaced.
          stale = true;
          return;
        }
        accumulated += chunk;
        // QNBS-v3: update the AI message in place via updateCharacterInterview to avoid N dispatches
        dispatch(
          projectActions.updateCharacterInterview({
            characterId,
            interviewId,
            changes: { updatedAt: aiMsgTimestamp },
          }),
        );
        // Directly mutate via a targeted appendInterviewMessage that overwrites the last AI msg
        // We re-dispatch a synthetic update to keep Redux as the single source of truth
        dispatch({
          type: 'project/streamInterviewChunk',
          payload: {
            characterId,
            interviewId,
            aiMsgId,
            content: accumulated,
            originIdentity,
          },
        });
      },
      signal,
    );

    if (stale) throw new StaleProjectOperationError('character interview stream');
    // QNBS-v3: a stream can finish without another chunk after a project switch, so completion needs its own authority check.
    assertProjectIdentityUnchanged(
      originIdentity,
      getProjectTargetIdentity((getState() as RootState).project.present),
      'character interview stream completion',
    );

    void aiOptions; // aiOptions used in future multi-provider path
    return { characterId, interviewId, aiMsgId, content: accumulated };
  },
);

export function createNewInterview(
  characterId: string,
  archetype: CharacterArchetype,
  templateId: string,
  title?: string,
): CharacterInterview {
  const now = new Date().toISOString();
  return {
    id: uuidv4(),
    characterId,
    archetype,
    templateId,
    // QNBS-v3: exactOptionalPropertyTypes requires conditional spread for optional string fields
    ...(title !== undefined ? { title } : {}),
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}
