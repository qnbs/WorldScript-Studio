/**
 * Shared Zod validation for StoryCraft project JSON imports (browser + Tauri).
 * QNBS-v3: Einheitliches Schema verhindert divergierende Parse-Pfade und härter gegen korrupte Dateien.
 */
import { z } from 'zod';

const binderNodeTypeSchema = z.enum(['folder', 'text', 'note', 'image', 'pdf', 'link']);

export const binderNodeSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  type: binderNodeTypeSchema,
  title: z.string(),
  linkedSectionId: z.string().optional(),
  content: z.string().optional(),
  imageAssetId: z.string().optional(),
  sortIndex: z.number().default(0),
});

export type BinderNodeParsed = z.infer<typeof binderNodeSchema>;

const characterRelationshipSchema = z.object({
  id: z.string(),
  fromCharacterId: z.string(),
  toCharacterId: z.string(),
  type: z.enum([
    'family',
    'romantic',
    'friend',
    'enemy',
    'mentor',
    'rival',
    'ally',
    'acquaintance',
  ]),
  description: z.string().optional(),
  strength: z.number(),
});

const characterSchema = z.object({
  id: z.string(),
  name: z.string(),
  backstory: z.string().optional().default(''),
  motivation: z.string().optional().default(''),
  appearance: z.string().optional().default(''),
  personalityTraits: z.string().optional().default(''),
  flaws: z.string().optional().default(''),
  notes: z.string().optional().default(''),
  hasAvatar: z.boolean().optional(),
  characterArc: z.string().optional().default(''),
  relationships: z.string().optional().default(''),
  avatarBase64: z.string().optional(),
});

const worldLocationSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  coordinates: z.object({ lat: z.number(), lng: z.number() }).optional(),
  type: z.enum(['city', 'village', 'forest', 'mountain', 'castle', 'temple', 'other']),
  population: z.number().optional(),
  significance: z.string().optional(),
});

const worldTimelineEventSchema = z.object({
  id: z.string(),
  era: z.string(),
  year: z.number().optional(),
  title: z.string(),
  description: z.string(),
  date: z.string().optional(),
  locationId: z.string().optional(),
  characterIds: z.array(z.string()).optional(),
});

const worldSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional().default(''),
  geography: z.string().optional().default(''),
  magicSystem: z.string().optional().default(''),
  culture: z.string().optional().default(''),
  notes: z.string().optional().default(''),
  hasAmbianceImage: z.boolean().optional(),
  timeline: z.array(worldTimelineEventSchema).optional().default([]),
  locations: z.array(worldLocationSchema).optional().default([]),
  relationships: z.array(characterRelationshipSchema).optional(),
  ambianceImageBase64: z.string().optional(),
});

const storySectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string().optional().default(''),
  prompt: z.string().optional(),
  summary: z.string().optional(),
  notes: z.string().optional(),
  color: z.string().optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  characterIds: z.array(z.string()).optional(),
  worldIds: z.array(z.string()).optional(),
  wordCount: z.number().optional(),
  status: z.enum(['draft', 'outline', 'first-draft', 'revised', 'final']).optional(),
  act: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
});

const outlineSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  isTwist: z.boolean().optional(),
});

const entityStateSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    ids: z.array(z.string()),
    entities: z.record(z.string(), item),
  });

const charactersFieldSchema = z.union([
  z.array(characterSchema),
  entityStateSchema(characterSchema),
]);

const worldsFieldSchema = z.union([z.array(worldSchema), entityStateSchema(worldSchema)]);

const writingHistoryEntrySchema = z.object({
  date: z.string(),
  words: z.number(),
});

const writingSessionSchema = z.object({
  id: z.string(),
  date: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  wordsWritten: z.number(),
  sectionId: z.string().optional(),
  notes: z.string().optional(),
});

const writingGoalSchema = z.object({
  id: z.string().optional(),
  type: z.enum(['words', 'time', 'sessions', 'daily', 'weekly', 'monthly', 'total']),
  target: z.number(),
  current: z.number().optional(),
  period: z.union([z.literal('daily'), z.literal('weekly'), z.literal('monthly'), z.string()]),
  achieved: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

const versionControlPersistSchema = z.object({
  branches: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      color: z.string(),
      createdAt: z.string(),
      headSnapshotId: z.string().optional(),
    }),
  ),
  snapshots: z.array(
    z.object({
      id: z.string(),
      branchId: z.string(),
      label: z.string(),
      timestamp: z.string(),
      manuscriptSnapshot: z.string(),
      wordCount: z.number(),
      parentId: z.string().optional(),
      sectionId: z.string().optional(),
    }),
  ),
  currentBranchId: z.string(),
});

/** Full export / backup JSON shape (matches extended ProjectData on disk). */
export const importedProjectJsonSchema = z.object({
  id: z.string().optional(),
  title: z.string(),
  logline: z.string(),
  author: z.string().optional(),
  characters: charactersFieldSchema.optional(),
  worlds: worldsFieldSchema.optional(),
  outline: z.array(outlineSectionSchema).optional(),
  manuscript: z.array(storySectionSchema).optional(),
  relationships: z.array(characterRelationshipSchema).optional(),
  projectGoals: z
    .object({
      totalWordCount: z.number(),
      targetDate: z.string().nullable(),
    })
    .optional(),
  writingHistory: z.array(writingHistoryEntrySchema).optional(),
  writingSessions: z.array(writingSessionSchema).optional(),
  writingGoals: z.array(writingGoalSchema).optional(),
  sceneBoardLayout: z.record(z.string(), z.object({ x: z.number(), y: z.number() })).optional(),
  binderNodes: z.array(binderNodeSchema).optional(),
  persistedVersionControl: versionControlPersistSchema.optional(),
});

export type ImportedProjectJson = z.infer<typeof importedProjectJsonSchema>;

export function parseImportedProjectJson(text: string): ImportedProjectJson {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error('Invalid project file: not valid JSON.');
  }
  const result = importedProjectJsonSchema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid project file: ${detail}`);
  }
  return result.data;
}
