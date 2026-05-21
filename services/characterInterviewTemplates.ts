import type { CharacterArchetype } from '../types';

export interface InterviewQuestion {
  id: string;
  question: string;
  hint?: string;
}

export interface InterviewTemplate {
  archetype: CharacterArchetype;
  label: string;
  description: string;
  questions: InterviewQuestion[];
}

// QNBS-v3: static registry of archetype-based questions; no network call required
const TEMPLATES: InterviewTemplate[] = [
  {
    archetype: 'hero',
    label: 'Hero',
    description: 'The protagonist who answers the call to adventure.',
    questions: [
      {
        id: 'hero-01',
        question: 'What was the moment you first realized something had to change?',
      },
      { id: 'hero-02', question: 'What fear do you carry that no one else knows about?' },
      { id: 'hero-03', question: 'Who or what gives you strength when you feel like giving up?' },
      { id: 'hero-04', question: 'What is the hardest sacrifice you have made so far?' },
      {
        id: 'hero-05',
        question: 'When you imagine the world after your quest succeeds, what does it look like?',
      },
      {
        id: 'hero-06',
        question: 'Have you ever doubted whether you are the right person for this?',
      },
      { id: 'hero-07', question: 'What rule or belief from your past no longer serves you?' },
      { id: 'hero-08', question: 'Describe the last time you failed someone you cared about.' },
      { id: 'hero-09', question: 'What would make you abandon everything and walk away?' },
      {
        id: 'hero-10',
        question:
          'If you could send one message to the version of yourself before all this began, what would it say?',
      },
    ],
  },
  {
    archetype: 'mentor',
    label: 'Mentor',
    description: "The guide who imparts wisdom and accelerates the hero's growth.",
    questions: [
      {
        id: 'mentor-01',
        question: 'What failure taught you the lesson you now share most freely?',
      },
      { id: 'mentor-02', question: 'Why did you choose to guide this particular person?' },
      {
        id: 'mentor-03',
        question: 'What part of your own journey do you keep hidden from those you teach?',
      },
      { id: 'mentor-04', question: 'Is there a student you failed? What happened?' },
      {
        id: 'mentor-05',
        question: 'When do you know it is time to step back and let someone fall?',
      },
      { id: 'mentor-06', question: 'What wisdom do you still wish someone had given you?' },
      { id: 'mentor-07', question: 'How do you prevent your guidance from becoming control?' },
      { id: 'mentor-08', question: 'What is the cost you pay for the power you carry?' },
    ],
  },
  {
    archetype: 'villain',
    label: 'Villain',
    description: "The antagonist who opposes the hero's goal.",
    questions: [
      {
        id: 'villain-01',
        question: 'When did the world first show you it does not play by fair rules?',
      },
      {
        id: 'villain-02',
        question: 'What do you want more than anything, and why does that justify what you do?',
      },
      { id: 'villain-03', question: 'Who did you used to be before you became who you are now?' },
      { id: 'villain-04', question: 'Is there anyone whose opinion of you still matters?' },
      { id: 'villain-05', question: 'What would it take for you to change course?' },
      {
        id: 'villain-06',
        question: 'Describe the exact moment you decided the ends justified the means.',
      },
      { id: 'villain-07', question: 'What do you genuinely fear?' },
      { id: 'villain-08', question: 'Do you believe you are the villain of this story?' },
    ],
  },
  {
    archetype: 'shadow',
    label: 'Shadow',
    description: "The dark reflection of the hero's unacknowledged self.",
    questions: [
      {
        id: 'shadow-01',
        question: 'What part of the hero do you represent that they refuse to face?',
      },
      { id: 'shadow-02', question: 'What would happen if the hero simply accepted you?' },
      { id: 'shadow-03', question: 'When did repression stop working and begin to fester?' },
      { id: 'shadow-04', question: 'Do you want to destroy the hero or be integrated into them?' },
      { id: 'shadow-05', question: 'What truth are you trying to force the hero to confront?' },
      { id: 'shadow-06', question: 'How do you grow stronger every time the hero denies you?' },
    ],
  },
  {
    archetype: 'trickster',
    label: 'Trickster',
    description: 'The agent of chaos who disrupts the status quo.',
    questions: [
      {
        id: 'trickster-01',
        question: 'What lie does the established order tell that you most enjoy exposing?',
      },
      { id: 'trickster-02', question: 'Is there anything you take seriously?' },
      { id: 'trickster-03', question: 'When has your chaos caused genuine harm you regret?' },
      { id: 'trickster-04', question: 'Who are you when no one is watching?' },
      {
        id: 'trickster-05',
        question: 'What rule exists precisely because of something you once did?',
      },
      { id: 'trickster-06', question: 'Is your chaos selfless or selfish?' },
    ],
  },
  {
    archetype: 'shapeshifter',
    label: 'Shapeshifter',
    description: 'The character whose loyalty and identity remain ambiguous.',
    questions: [
      { id: 'shape-01', question: 'Who are you when you stop performing for others?' },
      {
        id: 'shape-02',
        question: 'What is the one identity you have never been willing to abandon?',
      },
      {
        id: 'shape-03',
        question: 'When did you first learn that changing who you are kept you safer?',
      },
      { id: 'shape-04', question: 'Is there anyone who sees through all your masks?' },
      {
        id: 'shape-05',
        question: 'What do you truly believe — or do you believe anything at all?',
      },
      { id: 'shape-06', question: 'What happens to you when loyalty is finally demanded?' },
    ],
  },
  {
    archetype: 'herald',
    label: 'Herald',
    description: "The messenger who announces change and catalyses the hero's journey.",
    questions: [
      { id: 'herald-01', question: 'What change are you heralding, and why does it matter?' },
      { id: 'herald-02', question: 'Do you know what comes after you deliver your message?' },
      { id: 'herald-03', question: 'What would happen if the hero refused to answer the call?' },
      { id: 'herald-04', question: 'Are you a willing messenger or a compelled one?' },
      { id: 'herald-05', question: 'What do you know that you are not allowed to reveal?' },
    ],
  },
  {
    archetype: 'ally',
    label: 'Ally',
    description: 'The loyal companion who aids the hero on the journey.',
    questions: [
      { id: 'ally-01', question: 'Why have you chosen to support this person specifically?' },
      { id: 'ally-02', question: 'What do you want that the hero cannot give you?' },
      { id: 'ally-03', question: 'Has the hero ever let you down? How did you handle it?' },
      {
        id: 'ally-04',
        question: 'Where is the line you will not cross, even for someone you believe in?',
      },
      {
        id: 'ally-05',
        question: 'Do you think the hero really sees you, or just finds you useful?',
      },
      { id: 'ally-06', question: 'What are you sacrificing by staying on this path?' },
    ],
  },
  {
    archetype: 'threshold-guardian',
    label: 'Threshold Guardian',
    description: "The gatekeeper who tests the hero's worthiness before they can advance.",
    questions: [
      { id: 'tg-01', question: 'What quality must someone possess before you let them pass?' },
      {
        id: 'tg-02',
        question: 'How many have you turned away, and were any of them right to be refused?',
      },
      { id: 'tg-03', question: 'Do you guard this threshold willingly, or are you bound to it?' },
      { id: 'tg-04', question: 'What would it take for you to abandon your post?' },
      {
        id: 'tg-05',
        question: 'Have you yourself ever been tested in the same way you now test others?',
      },
    ],
  },
];

export function getTemplateForArchetype(
  archetype: CharacterArchetype,
): InterviewTemplate | undefined {
  return TEMPLATES.find((t) => t.archetype === archetype);
}

export function getAllTemplates(): InterviewTemplate[] {
  return TEMPLATES;
}

export function getQuestionsForArchetype(archetype: CharacterArchetype): InterviewQuestion[] {
  return getTemplateForArchetype(archetype)?.questions ?? [];
}
