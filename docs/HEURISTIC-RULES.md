# Heuristic Rules Reference

The Copilot's heuristic engine (`services/copilot/heuristicEngine.ts`) runs 8 built-in rules against your project. All rules are pure TypeScript — no AI calls, no network, zero cost.

Rules fire in `insightGenerator.ts` on a 400 ms debounce after every project change. Results are cached (LRU, 10 entries) keyed by a content hash so unrelated edits don't re-trigger analysis.

---

## `tension-drop` — TensionDropRule

**Severity:** warning  
**Target view:** sceneboard

Detects chapters where the heuristic tension score drops ≥ 20 percentage points compared to the previous chapter without a subsequent resolution beat in the same act.

**How to satisfy:** add a midpoint or reversal beat in the flagged chapter range, or adjust the `plotTensionOverrides` for those chapters in the Plot Board.

---

## `underdeveloped-character` — UnderdevelopedCharacterRule

**Severity:** warning  
**Target view:** characters

Fires when a character appears ≥ 2 times in the manuscript (word-boundary match, case-insensitive) but has neither a character arc nor a motivation filled in their profile.

**How to satisfy:** open the character's profile and fill in the Arc and Motivation fields.

---

## `open-loop` — OpenLoopRule

**Severity:** info  
**Target view:** sceneboard

Fires when more than 60 % of your chapters are assigned to Act II but no chapter has a midpoint beat marker. Long Act IIs without a midpoint often feel meandering.

**How to satisfy:** mark one Act II chapter as the midpoint beat, or redistribute chapters between acts.

---

## `slow-pacing` — SlowPacingRule

**Severity:** info  
**Target view:** manuscript

Fires when 3 or more consecutive chapters each fall below 60 % of the project's average chapter word count.

**How to satisfy:** expand the flagged chapters or merge them; alternatively, intentionally short chapters (e.g. action cuts) can be excluded by adjusting your target average.

---

## `high-repetition` — HighRepetitionRule

**Severity:** warning  
**Target view:** manuscript

Detects when the same noun/verb cluster appears > 5 times across 3 adjacent paragraphs (measured by Jaccard similarity of word sets). Excessive repetition signals a lack of lexical variety.

**How to satisfy:** vary word choice in the flagged paragraph range; the "Tell me more" button will ask the Copilot for synonym suggestions.

---

## `plot-hole` — PlotHoleRule

**Severity:** error  
**Target view:** manuscript

Fires when a character is mentioned in an earlier chapter (word-boundary match) before the chapter where they are first introduced according to the manuscript order. This can confuse readers who encounter a name before the character exists in the story.

**How to satisfy:** either move the character's introduction chapter earlier, or remove/reframe the early mention.

---

## `missing-world-context` — MissingWorldContextRule

**Severity:** warning  
**Target view:** world

Fires when a world entry's name appears in the manuscript (word-boundary match, case-insensitive) but the entry's completeness score is below 20 % (description + geography + culture fields empty or very short).

**How to satisfy:** open the world entry and add at least a short description and one additional field.

---

## `overlength-scene` — OverlengthSceneRule

**Severity:** info  
**Target view:** manuscript

Fires when a single chapter's word count exceeds 4 × the project's mean chapter word count. Unusually long chapters can disrupt pacing and reader engagement.

**How to satisfy:** consider splitting the chapter into two, or confirm the length is intentional (e.g. an epilogue) and dismiss the insight.

---

## Adding a custom rule

Implement the `HeuristicRule` interface in `services/copilot/heuristicEngine.ts` and add it to the `RULES` array:

```ts
interface HeuristicRule {
  id: string;
  severity: 'info' | 'warning' | 'error';
  detect(project: ProjectData, ctx: CopilotContext): HeuristicFinding[];
}
```

Each `HeuristicFinding` must include `titleKey` and `descriptionKey` (i18n keys) plus `params` for interpolation. The UI calls `t(finding.titleKey, finding.params)` — the rule engine never handles translated text directly.
