import type {
  Character,
  StoryCodex,
  StoryCodexConsistencyHint,
  StoryCodexEntity,
  StoryCodexRelationshipEdge,
  StorySection,
  World,
} from '../types';
import { storageService } from './storageService';

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

const buildEntityId = (name: string, type: string): string =>
  `${type.toLowerCase()}-${name.toLowerCase().replace(/\s+/g, '-')}`;

const createStoryCodexEntity = (
  name: string,
  type: StoryCodexEntity['type'],
  known: boolean,
  canonicalId?: string,
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

export type ExtractCodexOptions = {
  /** Adds co-mention graph edges + rule-based consistency hints (Story Bible Light). */
  advanced?: boolean;
};

function buildRelationshipEdges(entities: StoryCodexEntity[]): StoryCodexRelationshipEdge[] {
  const sectionToIds = new Map<string, Set<string>>();
  for (const ent of entities) {
    for (const m of ent.mentions) {
      if (!sectionToIds.has(m.sectionId)) {
        sectionToIds.set(m.sectionId, new Set());
      }
      sectionToIds.get(m.sectionId)!.add(ent.id);
    }
  }

  const pairMap = new Map<
    string,
    { source: string; target: string; weight: number; sections: Set<string> }
  >();

  for (const [sectionId, idSet] of sectionToIds) {
    const ids = [...idSet].sort();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i]!;
        const b = ids[j]!;
        const source = a < b ? a : b;
        const target = a < b ? b : a;
        const key = `${source}::${target}`;
        const edge = pairMap.get(key) ?? {
          source,
          target,
          weight: 0,
          sections: new Set<string>(),
        };
        edge.weight += 1;
        edge.sections.add(sectionId);
        pairMap.set(key, edge);
      }
    }
  }

  return [...pairMap.values()]
    .map((e) => ({
      sourceEntityId: e.source,
      targetEntityId: e.target,
      weight: e.weight,
      sectionIds: [...e.sections],
    }))
    .sort((x, y) => y.weight - x.weight)
    .slice(0, 200);
}

function buildConsistencyHints(entities: StoryCodexEntity[]): StoryCodexConsistencyHint[] {
  const hints: StoryCodexConsistencyHint[] = [];

  for (const ent of entities) {
    if (ent.type === 'unknown' && ent.mentionCount >= 8) {
      hints.push({
        id: `unknown-heavy-${ent.id}`,
        severity: 'warn',
        message: `"${ent.name}" appears often but is not linked to a character or world — consider defining it in your bible.`,
        entityIds: [ent.id],
      });
    }
    if (ent.known && ent.type === 'character' && ent.mentionCount === 0) {
      hints.push({
        id: `absent-char-${ent.id}`,
        severity: 'info',
        message: `Character "${ent.name}" is defined but never mentioned in the manuscript.`,
        entityIds: [ent.id],
      });
    }
  }

  return hints.slice(0, 50);
}

// QNBS-v3: ES2025 `RegExp.escape` is missing in some test runtimes (Vitest/jsdom); fallback mirrors core escaping.
const escapeRegExpLiteral = (s: string): string => {
  const R = RegExp as unknown as { escape?: (input: string) => string };
  if (typeof R.escape === 'function') return R.escape(s);
  return s.replace(/[\\^$*+?.()|[\]{}]/g, '\\$&');
};

// QNBS-v3: Binder-Research in Codex einbeziehen — konsistente Story-Bible auch jenseits des Manuskripts.
export const extractStoryCodex = (
  projectId: string,
  manuscript: StorySection[],
  characters: Character[],
  worlds: World[],
  options?: ExtractCodexOptions,
  /** Binder/research text nodes (e.g. id prefix binder-) scanned like manuscript sections. */
  extraSections: StorySection[] = [],
): StoryCodex => {
  const entityMap = new Map<string, StoryCodexEntity>();

  const addMention = (
    entityName: string,
    type: StoryCodexEntity['type'],
    section: StorySection,
    index: number,
    nameId?: string,
    known = false,
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

  const sectionsToScan = [...manuscript, ...extraSections];

  for (const section of sectionsToScan) {
    const text = `${section.title}\n${section.content}`;

    for (const known of knownEntities) {
      const regex = new RegExp(`\\b${escapeRegExpLiteral(known.name)}\\b`, 'gi');
      let match: RegExpExecArray | null = regex.exec(text);
      while (match) {
        addMention(known.name, known.type, section, match.index, known.id, true);
        match = regex.exec(text);
      }
    }

    const properNounRegex = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/g;
    for (const match of text.matchAll(properNounRegex)) {
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

  const base: StoryCodex = {
    projectId,
    extractedAt: new Date().toISOString(),
    entities,
    summary: summary || 'No story codex entries could be extracted from the manuscript yet.',
  };

  if (!options?.advanced) {
    return base;
  }

  return {
    ...base,
    relationshipEdges: buildRelationshipEdges(entities),
    consistencyHints: buildConsistencyHints(entities),
  };
};

export const saveStoryCodex = async (codex: StoryCodex): Promise<void> => {
  await storageService.saveStoryCodex(codex);
};

export const loadStoryCodex = async (projectId: string): Promise<StoryCodex | null> => {
  return storageService.getStoryCodex(projectId);
};
