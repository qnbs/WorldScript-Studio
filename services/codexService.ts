import { dbService } from './dbService';
import type { Character, StoryCodex, StoryCodexEntity, StorySection, World } from '../types';

const STOPWORDS = new Set([
  'The',
  'A',
  'An',
  'It',
  'They',
  'He',
  'She',
  'This',
  'That',
  'These',
  'Those',
  'His',
  'Her',
  'Their',
  'Its',
  'In',
  'On',
  'At',
  'Of',
  'For',
  'From',
  'To',
  'With',
  'Without',
  'And',
  'But',
  'Or',
  'Nor',
  'Yet',
  'So',
]);

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildEntityId = (name: string, type: string): string =>
  `${type.toLowerCase()}-${name.toLowerCase().replace(/\s+/g, '-')}`;

const createStoryCodexEntity = (
  name: string,
  type: StoryCodexEntity['type'],
  known: boolean,
  canonicalId?: string
): StoryCodexEntity => ({
  id: buildEntityId(name, type),
  name,
  type,
  known,
  canonicalId,
  mentionCount: 0,
  mentions: [],
});

const getExcerpt = (text: string, index: number, length = 40): string => {
  const start = Math.max(0, index - length);
  const end = Math.min(text.length, index + length);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
};

const normalizeCandidate = (candidate: string): string => candidate.trim().replace(/\s+/g, ' ');

export const extractStoryCodex = (
  projectId: string,
  manuscript: StorySection[],
  characters: Character[],
  worlds: World[]
): StoryCodex => {
  const entityMap = new Map<string, StoryCodexEntity>();

  const addMention = (
    entityName: string,
    type: StoryCodexEntity['type'],
    section: StorySection,
    index: number,
    nameId?: string,
    known = false
  ) => {
    const normalizedName = normalizeCandidate(entityName);
    const key = normalizedName.toLowerCase();
    const canonicalId = nameId;
    if (!entityMap.has(key)) {
      entityMap.set(key, createStoryCodexEntity(normalizedName, type, known, canonicalId));
    }
    const entity = entityMap.get(key)!;
    entity.mentionCount += 1;
    entity.mentions.push({
      sectionId: section.id,
      sectionTitle: section.title,
      excerpt: getExcerpt(`${section.title}\n${section.content}`, index),
      count: 1,
    });
  };

  const knownEntities = [
    ...characters.map((character) => ({
      name: character.name,
      type: 'character' as const,
      id: character.id,
    })),
    ...worlds.map((world) => ({
      name: world.name,
      type: 'world' as const,
      id: world.id,
    })),
  ];

  const knownNameIndex = new Map<
    string,
    { name: string; type: StoryCodexEntity['type']; id: string }
  >();

  for (const entity of knownEntities) {
    knownNameIndex.set(entity.name.toLowerCase(), entity);
  }

  for (const section of manuscript) {
    const text = `${section.title}\n${section.content}`;

    for (const known of knownEntities) {
      const regex = new RegExp(`\\b${escapeRegExp(known.name)}\\b`, 'gi');
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text))) {
        addMention(known.name, known.type, section, match.index, known.id, true);
      }
    }

    const properNounRegex = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/g;
    let match: RegExpExecArray | null;
    while ((match = properNounRegex.exec(text))) {
      const candidate = normalizeCandidate(match[1] ?? '');
      const normalized = candidate.toLowerCase();
      if (STOPWORDS.has(candidate) || normalized.length < 3) continue;
      if (knownNameIndex.has(normalized)) continue;
      if (entityMap.has(normalized) && entityMap.get(normalized)!.known) continue;

      addMention(candidate, 'unknown', section, match.index, undefined, false);
    }
  }

  // Ensure known entities appear even if not mentioned explicitly in manuscript
  for (const known of knownEntities) {
    const normalized = known.name.toLowerCase();
    if (!entityMap.has(normalized)) {
      entityMap.set(normalized, createStoryCodexEntity(known.name, known.type, true, known.id));
    }
  }

  const entities = Array.from(entityMap.values()).sort((a, b) => b.mentionCount - a.mentionCount);
  const summary = entities
    .slice(0, 30)
    .map((entity) => `${entity.type}: ${entity.name} (${entity.mentionCount} mentions)`)
    .join('\n');

  return {
    projectId,
    extractedAt: new Date().toISOString(),
    entities,
    summary: summary || 'No story codex entries could be extracted from the manuscript yet.',
  };
};

export const saveStoryCodex = async (codex: StoryCodex): Promise<void> => {
  await dbService.saveStoryCodex(codex);
};

export const loadStoryCodex = async (projectId: string): Promise<StoryCodex | null> => {
  return dbService.getStoryCodex(projectId);
};
