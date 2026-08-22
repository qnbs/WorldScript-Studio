// QNBS-v3: Exercise populated optional branches so selector mutations cannot hide missing project-state coverage.
import { describe, expect, it } from "vitest";
import type { RootState } from "../../app/store";
import {
  makeSelectInterviewsByCharacter,
  makeSelectMindMapById,
  makeSelectObjectById,
  makeSelectSectionById,
  makeSelectSectionsForAct,
  selectAiCreativity,
  selectCharacterIds,
  selectCharacterInterviewsAll,
  selectCharacterById,
  selectEditorSettings,
  selectEffectiveAiCreativity,
  selectEffectiveAiOptions,
  selectLanguage,
  selectManuscriptSectionCount,
  selectMindMaps,
  selectObjectGroups,
  selectPlotConnections,
  selectPlotSubplots,
  selectPlotTensionOverrides,
  selectProjectAiPreset,
  selectWritingHistory,
  selectProjectData,
  selectStoryObjects,
  selectStorySections,
  selectTheme,
  selectTotalCharacters,
  selectTotalWordCount,
  selectTotalWorlds,
  selectWorldIds,
  selectWorldById,
} from "../../features/project/projectSelectors";
import { charactersAdapter, worldsAdapter, type ProjectData } from "../../features/project/projectSlice";
import { buildState } from "./projectStateFixture";

const populatedData: Partial<ProjectData> = {
  outline: [{ id: "outline-1", title: "Opening", description: "The story begins" }],
  manuscript: [
    { id: "scene-1", title: "One", content: "  alpha\\n beta  ", act: 1 },
    { id: "scene-2", title: "Two", content: "gamma", act: 2 },
  ],
  relationships: [
    { id: "relationship-1", fromCharacterId: "character-1", toCharacterId: "character-2", type: "friend", strength: 5 },
  ],
  writingHistory: [{ date: "2026-08-22", words: 12 }],
  projectGoals: { totalWordCount: 1234, targetDate: "2026-12-31" },
  plotConnections: [{ id: "connection-1", fromSectionId: "scene-1", toSectionId: "scene-2", type: "cause-effect" }],
  plotSubplots: [{ id: "subplot-1", name: "B plot", color: "#a855f7", sectionIds: ["scene-2"] }],
  plotTensionOverrides: { "scene-1": 0.75 },
  aiPreset: { enabled: true, provider: "openai", model: "gpt-4o-mini", creativity: "Imaginative", temperature: 0.2, maxTokens: 321 },
  storyObjects: [{ id: "object-1", name: "Key", description: "A key", type: "prop", groupIds: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" }],
  objectGroups: [{ id: "group-1", name: "Props", color: "#111111", objectIds: ["object-1"], createdAt: "2026-01-01", updatedAt: "2026-01-01" }],
  mindMaps: [{ id: "map-1", projectId: "default", name: "Map", nodes: [], edges: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" }],
  characterInterviews: {
    "character-1": [{ id: "interview-1", characterId: "character-1", archetype: "hero", templateId: "default", messages: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" }],
  },
};

function populatedState(): RootState {
  const characters = charactersAdapter.addMany(charactersAdapter.getInitialState(), [
    { id: "character-1", name: "Alice", backstory: "", motivation: "", appearance: "", personalityTraits: "", flaws: "", notes: "", characterArc: "", relationships: "" },
    { id: "character-2", name: "Bob", backstory: "", motivation: "", appearance: "", personalityTraits: "", flaws: "", notes: "", characterArc: "", relationships: "" },
  ]);
  const worlds = worldsAdapter.addOne(worldsAdapter.getInitialState(), {
    id: "world-1", name: "World", description: "", geography: "", magicSystem: "", culture: "", notes: "", timeline: [], locations: [],
  });
  return buildState({ ...populatedData, characters, worlds });
}

describe("project selector populated branches", () => {
  it("returns project collections and entity adapter projections", () => {
    const state = populatedState();
    expect(selectProjectData(state)?.title).toBe("Test");
    expect(selectCharacterIds(state)).toEqual(["character-1", "character-2"]);
    expect(selectCharacterById(state, "character-2")?.name).toBe("Bob");
    expect(selectTotalCharacters(state)).toBe(2);
    expect(selectWorldIds(state)).toEqual(["world-1"]);
    expect(selectWorldById(state, "world-1")?.name).toBe("World");
    expect(selectTotalWorlds(state)).toBe(1);
    expect(selectStorySections(state)).toHaveLength(2);
    expect(selectManuscriptSectionCount(state)).toBe(2);
  });

  it("returns populated optional project branches and exact word boundaries", () => {
    const state = populatedState();
    expect(selectPlotConnections(state)).toHaveLength(1);
    expect(selectPlotSubplots(state)[0]?.sectionIds).toEqual(["scene-2"]);
    expect(selectPlotTensionOverrides(state)).toEqual({ "scene-1": 0.75 });
    expect(selectWritingHistory(state)[0]?.words).toBe(12);
    expect(selectProjectAiPreset(state)?.temperature).toBe(0.2);
    expect(selectStoryObjects(state)[0]?.id).toBe("object-1");
    expect(selectObjectGroups(state)[0]?.objectIds).toEqual(["object-1"]);
    expect(selectMindMaps(state)[0]?.id).toBe("map-1");
    expect(selectCharacterInterviewsAll(state)["character-1"]?.[0]?.id).toBe("interview-1");
    expect(selectProjectGoals(state)).toEqual({ totalWordCount: 1234, targetDate: "2026-12-31" });
  });

  it("counts trimmed whitespace-separated words and preserves selector factories", () => {
    const state = populatedState();
    expect(selectTotalWordCount(state)).toBe(4);
    expect(makeSelectObjectById()(state, "object-1")?.name).toBe("Key");
    expect(makeSelectMindMapById()(state, "map-1")?.name).toBe("Map");
    expect(makeSelectInterviewsByCharacter()(state, "character-1")).toHaveLength(1);
    expect(makeSelectSectionById()(state, "scene-2")?.act).toBe(2);
    expect(makeSelectSectionsForAct()(state, 1).map((section) => section.id)).toEqual(["scene-1"]);
    expect(makeSelectSectionsForAct()(state, 3)).toEqual([]);
  });

  it("uses project AI overrides only when enabled and keeps global settings otherwise", () => {
    const enabled = populatedState();
    expect(selectEffectiveAiCreativity(enabled)).toBe("Imaginative");
    expect(selectEffectiveAiOptions(enabled)).toEqual({ provider: "openai", model: "gpt-4o-mini", temperature: 0.2, maxTokens: 321 });

    const disabled = buildState({ aiPreset: { enabled: false, provider: "openai", model: "gpt-4o-mini", creativity: "Imaginative", temperature: 0.2, maxTokens: 321 } });
    expect(selectEffectiveAiCreativity(disabled)).toBe(selectAiCreativity(disabled));
    expect(selectEffectiveAiOptions(disabled)).toEqual({ provider: disabled.settings.advancedAi.provider, model: disabled.settings.advancedAi.model, temperature: disabled.settings.advancedAi.temperature, maxTokens: disabled.settings.advancedAi.maxTokens });
  });

  it("exposes settings-derived selectors without dropping fields", () => {
    const state = populatedState();
    expect(selectTheme(state)).toBe(state.settings.theme);
    expect(selectLanguage(state)).toBe(state.settings.language);
    expect(selectEditorSettings(state)).toEqual({
      editorFont: state.settings.editorFont,
      fontSize: state.settings.fontSize,
      lineSpacing: state.settings.lineSpacing,
      paragraphSpacing: state.settings.paragraphSpacing,
      indentFirstLine: state.settings.indentFirstLine,
    });
  });
});
