import { describe, expect, it, vi } from 'vitest';

// QNBS-v3: the thunk only touches storage for inline images, which this fixture does not carry.
vi.mock('../../services/storageService', () => ({
  storageService: {
    getQualifiedImage: vi.fn(async () => null),
    saveImage: vi.fn(async () => undefined),
    deleteQualifiedImage: vi.fn(async () => undefined),
  },
}));

import { importProjectThunk } from '../../features/project/thunks/projectManagementThunks';
import {
  AUTOSAVE_OWNED_TOP_LEVEL_FIELDS,
  buildAutosaveOwnedProjectEdit,
} from '../../services/projectAutosaveEditBridge';
import {
  commitOwnedProjectEdit,
  computeProjectSourceGeneration,
} from '../../services/projectDocumentWriteback';
import { importedProjectJsonSchema } from '../../services/projectImportSchema';

// QNBS-v3 (#553 a4/R2): one value per editor-owned top-level field, so a field missing from any stage of import → first save shows up by name.
const MODELED_FIELD_VALUES: Record<string, unknown> = {
  title: 'Imported',
  logline: 'L',
  author: 'A. Author',
  outline: [{ id: 'o1', title: 'Act I', description: 'Setup' }],
  manuscript: [{ id: 's1', title: 'Ch', content: 'text' }],
  relationships: [
    { id: 'r1', fromCharacterId: 'c1', toCharacterId: 'c2', type: 'friend', strength: 3 },
  ],
  projectGoals: { totalWordCount: 1234, targetDate: '2027-01-01' },
  writingHistory: [{ date: '2026-09-01', words: 42 }],
  sceneBoardLayout: { s1: { x: 1, y: 2 } },
  binderNodes: [],
  plotConnections: [{ id: 'pc1', fromSectionId: 's1', toSectionId: 's1', type: 'cause-effect' }],
  plotSubplots: [{ id: 'sp1', name: 'Romance', color: '#a855f7', sectionIds: ['s1'] }],
  plotTensionOverrides: { s1: 7 },
  aiPreset: { enabled: true, provider: 'openai', temperature: 0.4 },
  storyObjects: [
    {
      id: 'so1',
      name: 'Key',
      description: 'Old key',
      type: 'artifact',
      groupIds: [],
      createdAt: 't',
      updatedAt: 't',
    },
  ],
  objectGroups: [
    { id: 'g1', name: 'Items', color: '#fff', objectIds: [], createdAt: 't', updatedAt: 't' },
  ],
  mindMaps: [],
  characterInterviews: {},
};

async function importFile(document: Record<string, unknown>) {
  const text = JSON.stringify(document).replace(/}$/, ',"opaqueTop":{"exact":9007199254740993}}');
  const action = await importProjectThunk(new File([text], 'p.json', { type: 'application/json' }))(
    vi.fn(),
    () => ({}),
    undefined,
  );
  if (action.type !== 'project/importProject/fulfilled') {
    throw new Error(`import rejected: ${JSON.stringify((action as { error?: unknown }).error)}`);
  }
  const { payload, meta } = action as unknown as {
    payload: Record<string, unknown>;
    meta: { replacementCarrier: string | null };
  };
  return { payload, carrier: meta.replacementCarrier as string };
}

function firstSave(project: Record<string, unknown>, carrier: string): string {
  const result = commitOwnedProjectEdit({
    expectedGeneration: computeProjectSourceGeneration(carrier),
    currentRaw: carrier,
    edit: buildAutosaveOwnedProjectEdit(project as never, carrier),
  });
  if (result.status !== 'COMMITTED') throw new Error(`first save refused: ${result.status}`);
  return result.raw;
}

describe('import → editor → first save keeps every modeled field (#553 a4/R2)', () => {
  it('admits every editor-owned field in the import schema', () => {
    const admitted = new Set(Object.keys(importedProjectJsonSchema.shape));
    const notAdmitted = [...AUTOSAVE_OWNED_TOP_LEVEL_FIELDS].filter((key) => !admitted.has(key));
    expect(notAdmitted).toEqual([]);
  });

  it('covers every editor-owned field in this fixture', () => {
    const covered = new Set([...Object.keys(MODELED_FIELD_VALUES), 'id']);
    const uncovered = [...AUTOSAVE_OWNED_TOP_LEVEL_FIELDS].filter((key) => !covered.has(key));
    // writingSessions, writingGoals, compileProfile and persistedVersionControl are checked by their own schemas elsewhere; everything else must be exercised here.
    expect(uncovered.sort()).toEqual(
      ['compileProfile', 'persistedVersionControl', 'writingGoals', 'writingSessions'].sort(),
    );
  });

  it.each(Object.entries(MODELED_FIELD_VALUES))(
    'projects %s into the editor and keeps it through the first save',
    async (field, value) => {
      const { payload, carrier } = await importFile({
        schemaVersion: 1,
        id: 'p1',
        characters: [],
        worlds: [],
        ...MODELED_FIELD_VALUES,
      });

      expect(payload[field]).toEqual(value);
      const saved = JSON.parse(firstSave(payload, carrier)) as Record<string, unknown>;
      expect(saved[field]).toEqual(value);
    },
  );

  it('keeps opaque carrier fields and applies a genuine owned edit', async () => {
    const { payload, carrier } = await importFile({
      schemaVersion: 1,
      id: 'p1',
      characters: [],
      worlds: [],
      ...MODELED_FIELD_VALUES,
    });

    const saved = firstSave({ ...payload, plotTensionOverrides: { s1: 9 } }, carrier);

    expect(saved).toContain('"opaqueTop":{"exact":9007199254740993}');
    expect(JSON.parse(saved)).toMatchObject({ plotTensionOverrides: { s1: 9 }, mindMaps: [] });
  });

  it('does not invent absent optional fields beyond the established import defaults', async () => {
    const { payload } = await importFile({
      schemaVersion: 1,
      id: 'p1',
      title: 'Minimal',
      logline: 'L',
      characters: [],
      worlds: [],
    });

    for (const field of [
      'plotConnections',
      'plotSubplots',
      'plotTensionOverrides',
      'aiPreset',
      'storyObjects',
      'mindMaps',
    ]) {
      expect(Object.hasOwn(payload, field)).toBe(false);
    }
  });

  it('refuses a structurally invalid modeled field instead of importing it', async () => {
    await expect(
      importFile({
        schemaVersion: 1,
        id: 'p1',
        title: 'T',
        logline: 'L',
        aiPreset: { enabled: 'yes' },
      }),
    ).rejects.toThrow(/import rejected/);
  });

  // QNBS-v3 (#553 a4/R2): review corrections — routing, identity and score semantics stay safe in what import admits.
  it.each([
    [
      'an AI provider this build cannot dispatch',
      { aiPreset: { enabled: true, provider: 'unknown-ai' } },
    ],
    [
      'duplicate plot connection ids',
      {
        plotConnections: [
          { id: 'pc1', fromSectionId: 's1', toSectionId: 's1', type: 'parallel' },
          { id: 'pc1', fromSectionId: 's1', toSectionId: 's1', type: 'temporal' },
        ],
      },
    ],
    [
      'duplicate subplot ids',
      {
        plotSubplots: [
          { id: 'sp1', name: 'A', color: '#000', sectionIds: [] },
          { id: 'sp1', name: 'B', color: '#fff', sectionIds: [] },
        ],
      },
    ],
  ])('refuses %s', async (_label, fields) => {
    await expect(
      importFile({ schemaVersion: 1, id: 'p1', title: 'T', logline: 'L', ...fields }),
    ).rejects.toThrow(/import rejected/);
  });

  it('keeps a preset without an enabled flag loadable', async () => {
    const { payload } = await importFile({
      schemaVersion: 1,
      id: 'p1',
      title: 'T',
      logline: 'L',
      aiPreset: { model: 'legacy-model' },
    });
    expect(payload['aiPreset']).toEqual({ model: 'legacy-model' });
  });

  it('admits a stored null tension score but never projects it as a score', async () => {
    const { payload } = await importFile({
      schemaVersion: 1,
      id: 'p1',
      title: 'T',
      logline: 'L',
      plotTensionOverrides: { s1: 4, s2: null },
    });
    expect(payload['plotTensionOverrides']).toEqual({ s1: 4 });
  });
});
