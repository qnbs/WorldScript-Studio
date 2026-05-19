# Master Perfection Run v1.5 — Implementation Plan

## Context

StoryCraft Studio is at v1.4.0 with an extremely solid foundation: 4-layer local-AI fallback (detection-only for layers 2-3), Yjs E2E encryption, Cross-Project Search v2, CI gold-standard, 1,652 tests / 151 files, 62.86 % coverage. The goal is v1.5: integrate the full CannaGuide-2025 production-grade local-AI architecture, perfect the mobile 3-panel editor, and deliver Phase 2/3 feature completeness — zero compromises.

CannaGuide has 66+ local-AI files adapted for cannabis. We CANNOT import them directly (domain-specific). Instead, we extract every architectural pattern and create StoryCraft-native equivalents. The CannaGuide code is at `/home/pc/CannaGuide-2025/apps/web/services/local-ai/`.

---

## Gap Analysis: StoryCraft vs CannaGuide Local-AI

| Dimension | StoryCraft Current | CannaGuide Pattern | Action |
|---|---|---|---|
| WorkerBus | Priority queue, no backpressure, no preemption | Priority preemption (max 3×), backpressure (concurrency cap), transferables, rate limiting, W-02/W-03 telemetry | Upgrade `packages/ai-core/src/index.ts` WorkerBus class |
| GPU Mutex | Tab leader election (BroadcastChannel) | Full GPU mutex: consumer queue, priority sort, 30s auto-release, eviction hooks, multi-consumer (webllm / onnx-webgpu) | New `services/ai/gpuResourceManager.ts` |
| Device Health | VRAM tier from WebGPU adapter limits | Full health report: CPU cores, memory heap, storage quota, battery level, device class (high/mid/low/unknown) | New `services/ai/deviceHealthService.ts` |
| Eco Mode | None | Battery API + low-power detection → force 0.5B model + heuristics | New `services/ai/ecoModeService.ts` |
| Download Progress | Callback type defined, not wired to UI | Full progress emitter: subscribe/snapshot pattern, ARIA live region, cancel button | New `services/ai/inferenceProgressEmitter.ts` + WCAG modal |
| Model Recommendation | Static curated lists | Device-class → model auto-select (VRAM tier × task type) | Upgrade `services/ai/modelRecommendations.ts` |
| ONNX Inference | Detection only (returns message string) | Active inference via Transformers.js ONNX backend (quantized, WASM/WebGPU) | Upgrade Layer-2 in `packages/ai-core/src/index.ts` + worker |
| Transformers.js Inference | Detection only (returns echo string) | Worker-offloaded pipeline; singleton per model; pipeline cache (8 entries); device hint | New `src/workers/inference.worker.ts` + activate Layer-3 |
| Inference Cache | None at inference level | IndexedDB LRU (persistent) + in-memory LRU 64 entries (DJB2+FNV hash) | New `services/ai/aiInferenceCacheService.ts` |
| Embedding Service | BoW hash 64-dim (not semantic) | `Xenova/all-MiniLM-L6-v2` 384-dim, L2-normalized, worker-offloaded, batch micro-batch (8) | New `services/ai/localEmbeddingService.ts` |
| NLP Service | None | Sentiment analysis, text classification, summarization | New `services/ai/localNlpService.ts` |
| RAG Service | Single-project BoW cosine similarity | Hybrid: 60% semantic + 30% keyword token overlap + 10% recency; sliding window; max 500 chunks | Upgrade `services/localRagIndex.ts` to `localRagService.ts` |
| Cross-Project AI | None | AI-enriched index (summaries, embeddings) | Extend `crossProjectIndexService.ts` |
| Streaming Service | Via Vercel AI SDK only | Token-by-token streaming with backpressure via WorkerBus | Extend `services/ai/storyCraftCompletionFetch.ts` |
| Telemetry | WorkerBus counters only | Full inference telemetry: latencyMs, tokensPerSecond, errorRate, peakLatency, cached/uncached | New `services/ai/aiTelemetryService.ts` |
| Mobile Touch | Mouse events only (ManuscriptView resize) | Not in CannaGuide scope | Custom: PointerEvent resize, useSwipeGesture, BottomSheet, useLongPress, useHaptics |
| Prompt Library | Inline hardcoded in geminiService.ts | Not in CannaGuide scope | New `services/promptLibrary.ts` + versioned JSON |
| StyleTransfer | Missing | Not in CannaGuide scope | New AI tool |
| Plot Hole Auto-Fix | Detection only, no generation | Not in CannaGuide scope | Extend AI tool |
| Chapter Auto-Gen | Missing | Not in CannaGuide scope | New AI tool |
| Character Arc Visualizer | Missing | Not in CannaGuide scope | New view + hook + context |

---

## Sprint Timeline (14 Days, MoSCoW)

### Week 1: Local-AI Foundation (Phase 1.4)

**Day 1 — WorkerBus v2 + GPU Mutex**
- [M] Upgrade `WorkerBus` in `packages/ai-core/src/index.ts`:
  - Add `MAX_CONCURRENT` concurrency cap (default 3 for heavy inference, 8 for text)
  - Add `backpressure()` method that rejects tasks when `totalQueueDepth > MAX_QUEUE_SIZE (32)`
  - Add priority preemption: when `critical` task arrives, requeue interrupted `low` task (max 3× requeue before drop)
  - Add Transferable Object support to `WorkerTask` interface (already has `transferables?`)
  - Upgrade `WorkerBusTelemetry`: add `peakLatencyMs`, `errorRate`, `lastSuccessAt: number | null`
  - Add `AbortController` map: `taskAbortControllers: Map<string, AbortController>`; `cancel(taskId)` method
- [M] New `services/ai/gpuResourceManager.ts` (adapted from CannaGuide):
  - Consumers: `'webllm' | 'onnx-webgpu'`
  - Priority: `'high' | 'normal' | 'low'`
  - Auto-release timeout: 30s deadlock prevention
  - `acquireGpu(consumer, priority): Promise<void>`, `releaseGpu(consumer): void`
  - `getQueueState(): { current: Consumer | null, queue: Consumer[] }`
- [M] Tests: upgrade `tests/unit/aiCoreWorkerBus.test.ts` (add backpressure, preemption, cancel tests); new `tests/unit/gpuResourceManager.test.ts`

**Day 2 — Device Health + Eco Mode + Progress Emitter**
- [M] New `services/ai/deviceHealthService.ts`:
  - `getDeviceClass(): 'high-end' | 'mid-range' | 'low-end' | 'unknown'`
  - `getHealthReport(): DeviceHealthReport` (cores, heapUsed/total, storageQuota, batteryLevel, gpuVramTier)
  - `getModelRecommendation(task: 'text-gen' | 'embedding' | 'rag'): string` (maps device class + VRAM → specific model ID)
  - Memory pressure threshold: 80% mobile, 90% desktop
  - Storage quota check: 200 MB minimum for model downloads
- [S] New `services/ai/ecoModeService.ts`:
  - `isEcoMode(): boolean` (low battery < 20% + device class low-end)
  - `isCriticalBattery(): boolean` (< 10%)
  - `setEcoModeExplicit(active: boolean): void`
  - `applyAdaptiveMode(): Promise<void>` (reads Battery API, sets mode)
- [M] New `services/ai/inferenceProgressEmitter.ts`:
  - `WebLlmLoadingState` type: `'idle' | 'loading' | 'ready' | 'error'`
  - `WebLlmLoadProgress` type: `{ state, progress, text, estimatedSecondsRemaining }`
  - `reportWebLlmProgress(progress: number, text: string): void`
  - `reportWebLlmReady(): void`, `reportWebLlmError(msg: string): void`
  - `subscribeWebLlmLoading(cb): () => void` (pub/sub, returns unsubscribe)
  - `getWebLlmLoadingSnapshot(): WebLlmLoadProgress`
- [M] Tests: `tests/unit/deviceHealthService.test.ts` (device class detection, model recommendation, memory thresholds); `tests/unit/inferenceProgressEmitter.test.ts`

**Day 3 — Active ONNX + inference.worker.ts**
- [M] New `src/workers/inference.worker.ts`:
  - WorkerBus protocol (request/response with `messageId` correlation)
  - `isTrustedWorkerMessage(event): boolean` (origin check for security)
  - Dynamic import of `@xenova/transformers` with pipeline cache (max 8 pipelines)
  - Supported tasks: `text-generation`, `feature-extraction` (embeddings), `sentiment-analysis`, `summarization`
  - Inference options: `max_new_tokens`, `do_sample`, `temperature`, `return_full_text`
  - AbortController integration (listen for `WORKER_CANCEL` messages)
  - TypeScript: `/// <reference lib="webworker" />` at top
  - Vite: `{ type: 'module' }` worker registration
- [M] Upgrade Layer-2/3 in `packages/ai-core/src/index.ts` `runLocalTextGeneration()`:
  - Layer-2 ONNX: Actually load a model via Transformers.js ONNX backend (default `Xenova/distilgpt2` when no modelId supplied); use `inference.worker.ts` channel `local.text.generate`; timeout 30s desktop / 15s mobile
  - Layer-3 Transformers.js: Use CPU device hint WASM fallback; same worker, different quantization
  - Replace static message returns with real inference calls
  - Fix Layer-4 heuristic: fix bug where final return incorrectly says `layer: 'transformers'` → should be `layer: 'heuristic'`
- [M] Update `services/ai/index.ts` to re-export new services
- [M] Tests: `tests/unit/inferenceWorker.test.ts` (mock worker env, pipeline cache, trusted-message guard, abort); upgrade `tests/unit/aiCoreFallbackPaths.test.ts` for real ONNX/Transformers inference paths

**Day 4 — Cache Service + Embedding Service**
- [S] New `services/ai/aiInferenceCacheService.ts`:
  - In-memory LRU 64 entries (DJB2 + FNV hash of prompt + modelId)
  - Persistent IndexedDB cache (store: `storycraft-inference-cache`, max 256 entries, 7d TTL)
  - `getCachedInference(prompt, modelId): Promise<string | null>`
  - `setCachedInference(prompt, modelId, result): Promise<void>`
  - `clearPersistentCache(): Promise<void>`
  - Smart invalidation: skip cache for prompts > 512 chars (streaming / long context)
- [C] New `services/ai/localEmbeddingService.ts`:
  - Model: `Xenova/all-MiniLM-L6-v2` (384-dim via `inference.worker.ts` channel `local.embeddings.create`)
  - `embedText(text: string): Promise<Float32Array>` (L2-normalized)
  - `embedBatch(texts: string[]): Promise<Float32Array[]>` (micro-batch size 8)
  - `cosineSimilarity(a: Float32Array, b: Float32Array): number`
  - MAX_INPUT_LENGTH: 512 chars (truncate with warning)
  - Depends on `aiInferenceCacheService` for embedding cache
- [C] New `services/ai/localNlpService.ts`:
  - `analyzeSentiment(text): Promise<{ label: 'POSITIVE'|'NEGATIVE'|'NEUTRAL', score: number }>`
  - `summarizeText(text, maxLength?): Promise<string>`
  - `classifyWritingTopic(text): Promise<string>` (genre/mood classification)
  - Routes via WorkerBus channel `local.text.generate`
- [M] Tests: `tests/unit/aiInferenceCacheService.test.ts` (LRU eviction, TTL, IDB persistence mock); `tests/unit/localEmbeddingService.test.ts` (cosine sim, batch, truncation)

**Day 5 — Download Progress WCAG UI + Model Recommendation Engine**
- [M] Upgrade `services/ai/modelRecommendations.ts`:
  - Replace static list with `getModelRecommendationForTask(task, deviceReport): { webllm?, onnx?, transformers? }` 
  - VRAM tier mapping: `high` → Phi-3.5 Mini / Llama-3.2-3B; `medium` → Llama-3.2-1B; `low` → Gemma-2-2B q4 / DistilGPT-2
  - Task-specific: `text-gen` prefers larger models; `embedding` always routes to all-MiniLM; `rag` routes to DistilGPT-2
  - Eco mode override: always return 0.5B model (Xenova/Qwen2.5-0.5B-Instruct)
  - Export `getProviderSpeedEstimate(provider): Promise<number>` (lightweight ping test for Ollama)
- [M] New `components/settings/LocalAiDownloadProgress.tsx`:
  - Triggered by `subscribeWebLlmLoading()` 
  - WCAG 2.2 AA: `role="progressbar"`, `aria-valuenow`, `aria-valuetext="42% downloaded, approximately 30 seconds remaining"`
  - `aria-live="polite"` on status text; `aria-live="assertive"` on error
  - Cancel button: calls `gpuResourceManager.releaseGpu('webllm')` + signals AbortController
  - Progress bar, percentage text, estimated time (seconds remaining computed from rate)
  - Error recovery: "Retry" button
  - i18n: 8 new keys per locale → `locales/*/settings.json`
- [M] New `components/settings/GpuMetricsPanel.tsx`:
  - GPU queue state display (current consumer, waiting consumers)
  - WorkerBus telemetry: `processedTasks`, `avgExecutionMs`, `peakLatencyMs`, `errorRate`
  - Device class badge: High-end / Mid-range / Low-end
  - Eco mode toggle (calls `ecoModeService.setEcoModeExplicit()`)
  - Feature flag: `enableAppHealthPanel` (already exists in featureFlagsSlice)
  - i18n: 10 new keys per locale → `locales/*/settings.json`
- [M] Wire both components into `components/settings/AiSections.tsx`
- [M] Tests: `tests/unit/settings/LocalAiDownloadProgress.test.tsx` (progress bar render, ARIA attrs, cancel callback, error state); `tests/unit/settings/GpuMetricsPanel.test.tsx` (badge display, eco toggle)

**Day 6 — Upgrade RAG + Cross-Project AI Enrichment**
- [M] Upgrade `services/localRagIndex.ts` → rename to `services/localRagService.ts`:
  - Keep existing BoW as fallback (lexical branch)
  - Add semantic branch: uses `localEmbeddingService.embedText()` when embedding model loaded
  - Hybrid scoring: 60% cosine similarity + 30% token overlap + 10% recency boost
  - Sliding window: most recent 3 entries always included
  - MAX_CHUNKS: 500 (OOM prevention)
  - `retrieveContext(projectId, query, topK, mode: 'lexical'|'semantic'|'hybrid'): Promise<RagChunk[]>`
  - Add token-based chunking (replace section-based): 300-token chunks, 50-token overlap
  - Backward compat: old `searchLocalRag()` delegates to new `retrieveContext()`
- [S] Extend `crossProjectIndexService.ts`:
  - Add `aiSummary?: string` field to `ProjectSearchIndex` (100-char AI-generated essence)
  - `enrichProjectIndex(projectId): Promise<void>` — calls local AI to generate summary if model available; feature-flagged under `enableCrossProjectSearch`
  - `semanticSearchProjects(query, topK): Promise<ProjectSearchIndex[]>` — uses embeddings
- [M] Tests: upgrade `tests/unit/localRagService.test.ts` (hybrid scoring, sliding window, token chunking); extend `tests/unit/crossProjectIndexService.test.ts` (AI enrichment with mocked embedding service)

---

### Week 2: Mobile + Features + Docs (Phases 1.5, 2, 3)

**Day 7 — Mobile Writer Experience: Touch + PointerEvent**
- [M] Upgrade `components/ManuscriptView.tsx` resize handles:
  - Replace `MouseEvent` with `PointerEvent` everywhere (`onPointerDown`, `onPointerMove`, `onPointerUp`)
  - Add `setPointerCapture()` / `releasePointerCapture()` for reliable mobile drag
  - Keep keyboard resize (arrow keys) intact
  - Add `touch-action: none` CSS to resize handle elements (prevents scroll conflict)
  - Test: resize handles work on iOS Safari + Chrome Mobile
- [M] New `hooks/useSwipeGesture.ts`:
  - `useSwipeGesture(ref, { onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown, threshold?: number })`
  - Uses PointerEvent (pointerdown → pointermove → pointerup)
  - Threshold: 50px swipe distance, 300ms velocity window
  - Directional logic: horizontal vs vertical dominant axis
  - Applied in `components/writing/WriterViewUI.tsx` to switch 3-panel focus (outline → manuscript → tools)
- [S] New `hooks/useLongPress.ts`:
  - `useLongPress(callback, ms?: 600)`
  - PointerEvent-based; calls callback if held > ms without > 10px move
  - Applied to chapter items in outline panel → context menu
- [S] New `hooks/useHaptics.ts`:
  - `useHaptics()` → `{ vibrate(pattern?: number | number[]): void, canVibrate: boolean }`
  - Wraps `navigator.vibrate()`, degrades gracefully when unavailable
  - Called on swipe confirm, long-press trigger, panel resize snap
- [M] i18n: 6 new keys per locale (panel names, swipe hints)
- [M] Tests: `tests/unit/useSwipeGesture.test.ts` (mock PointerEvent sequence, threshold, direction); `tests/unit/useLongPress.test.ts`; upgrade `tests/unit/ManuscriptView.test.tsx` (PointerEvent resize)

**Day 8 — Mobile: BottomSheet + ARIA Live Regions**
- [M] New `components/ui/BottomSheet.tsx`:
  - Drawer-style bottom sheet with handle, backdrop, drag-to-dismiss
  - `props: { open, onClose, title, children, height?: 'half'|'full' }`
  - Drag handle: PointerEvent drag, snap to closed when dragged > 30% height
  - ARIA: `role="dialog"`, `aria-modal="true"`, `aria-labelledby`
  - Focus trap on open, restore on close
  - Backdrop: `onClick → onClose`; `Escape` key closes
  - Tailwind: `fixed inset-x-0 bottom-0 z-50 rounded-t-2xl bg-white dark:bg-slate-900`
  - Used on mobile for: AI Tools panel (mobile ≤ md), Character quick-view, World quick-view
- [M] Integrate `BottomSheet` into `components/writing/WriterViewUI.tsx`:
  - On mobile (< md), "AI Tools" tab opens a BottomSheet instead of inline column 3
  - Trigger: existing mobile segmented control AI tab
- [M] Add ARIA live regions for AI responses:
  - `components/writing/AiWritingPanel.tsx` (or equivalent): wrap streaming text in `<div role="status" aria-live="polite" aria-atomic="false">`
  - Per WCAG 2.2: each token chunk appended → screen reader announces when idle
  - Existing error messages: upgrade to `role="alert"` + `aria-live="assertive"` 
- [M] New `tests/e2e/mobile-touch.spec.ts`:
  - Bottom sheet open/close on mobile viewport
  - Panel switch via swipe gesture simulation
  - AI response live region announced
- [M] Tests: `tests/unit/BottomSheet.test.tsx` (open/close, focus trap, ARIA attrs, drag-to-dismiss)

**Day 9 — Prompt Library**
- [M] New `services/promptLibrary.ts`:
  - `PromptTemplate` interface: `{ id, version, name, category, localeKey, template(vars), chainable, abTestVariants? }`
  - Categories: `'outline' | 'character' | 'world' | 'manuscript' | 'consistency' | 'style-transfer' | 'plot-hole' | 'chapter-gen'`
  - Versioned: `v1.0.0` semver string per template
  - Locale-aware: `name` key points to i18n key; `template()` uses `t()` at call-time
  - Prompt chaining: `chainable: true` + `inputFromPreviousId?: string` → output of step N becomes input of step N+1
  - A/B hooks: `abTestVariants?: PromptTemplate[]` (uniform random selection, logged to telemetry)
  - Export/import: `exportPromptLibrary(): string` (JSON), `importPromptLibrary(json): void` (with JSON-schema validation)
  - `getPrompt(id: string, vars: Record<string, string>): string`
  - `listByCategory(category): PromptTemplate[]`
  - Migrate all 17 existing hardcoded prompts from `geminiService.ts` into this registry (keep geminiService calls pointing here)
- [S] New `components/settings/PromptLibraryPanel.tsx`:
  - List all prompts by category (accordion)
  - Export / Import buttons
  - Preview pane with variable substitution
- [M] i18n: prompt names in all 5 locales
- [M] Tests: `tests/unit/promptLibrary.test.ts` (getPrompt vars, chainable, export/import, a/b variant selection)

**Day 10 — StyleTransfer + Auto-Plot-Hole-Fixer**
- [M] New AI tool: `services/geminiService.ts` additions:
  - `promptType: 'styleTransfer'` — author voice mimicry: system prompt embeds `${authorStyle}` exemplar text; user message is the passage to transform; returns JSON `{ transformed: string, voiceNotes: string[] }`
  - `promptType: 'plotHoleFix'` — extends existing `plotHoleDetection`: takes existing analysis + manuscript context; generates specific fix suggestions per hole; returns JSON `{ fixes: Array<{ hole: string, suggestion: string, chapter?: string }> }`
- [M] View pattern for StyleTransfer: `components/StyleTransferView.tsx` + `hooks/useStyleTransferView.ts` + `contexts/StyleTransferContext.tsx`
  - Pure render: textarea for exemplar style + source passage, output panel
  - Business logic: debounced AI call, loading state, progress indicator
  - Author style presets: 5 built-in (Hemingway sparse, Gothic atmospheric, Literary flair, Thriller crisp, Fantasy epic)
- [S] Upgrade `components/ConsistencyCheckerView.tsx` (or equivalent): wire `plotHoleFix` as "Auto-Fix" button alongside existing detection results
- [M] i18n: 15 new keys (StyleTransfer view labels, tool names, presets)
- [M] Tests: `tests/unit/styleTransfer.test.ts` (geminiService mock, prompt construction, JSON response parsing); `tests/unit/plotHoleFix.test.ts`; `tests/unit/StyleTransferView.test.tsx`

**Day 11 — Chapter Auto-Generation + Character Arc Visualizer**
- [C] New AI tool `promptType: 'chapterAutoGeneration'`:
  - Input: `outlineSection` (structured outline item) + `existingChapters` (context) + `wordTarget`
  - Extended thinking: Gemini 2.0, budget 8192 tokens (complex narrative generation)
  - Returns JSON: `{ title, content: string, endingHook: string, wordCount: number }`
  - Placed behind feature flag `enableChapterAutoGen` (new flag in featureFlagsSlice)
- [C] View pattern: `components/ChapterAutoGenView.tsx` + `hooks/useChapterAutoGenView.ts` + `contexts/ChapterAutoGenContext.tsx`
  - Select outline sections to expand
  - Word target slider (500–5000)
  - Preview generated chapter in inline editor
- [S] New `components/CharacterArcVisualizerView.tsx` + hook + context:
  - Extracts character mentions per chapter from manuscript (existing Codex data)
  - Timeline visualization: SVG-based arc chart (X = chapters, Y = emotional state from consistency data)
  - Integration with Relationship-Graph (existing) for dual view
  - No AI call required — derives from existing Codex + Redux state
  - Feature flag: `enableCharacterArcVisualizer`
- [M] i18n: 18 new keys for both views
- [M] Tests: `tests/unit/chapterAutoGen.test.ts` (prompt construction, extended thinking params, JSON parsing); `tests/unit/CharacterArcVisualizerView.test.tsx` (timeline data derivation, SVG structure)

**Day 12 — Community Template Marketplace**
- [S] New `services/communityTemplateService.ts` additions:
  - Already exists; extend with:
  - `CommunityTemplate.schema.json` — JSON Schema v7 for template validation
  - `validateCommunityTemplate(raw: unknown): ValidationResult` — uses ajv (or manual zod schema)
  - `queueForModeration(template): void` — client-side moderation queue (IDB store `moderation-queue`)
  - `rateCommunityTemplate(id: string, rating: 1-5): void` — local ratings store
  - `ModerationStatus`: `'pending' | 'approved' | 'rejected'`
  - Contribution guide: `docs/COMMUNITY-TEMPLATES.md`
- [S] Upgrade `components/TemplateView.tsx` / `TemplateGallery`:
  - "Submit Template" flow: form → zod validate → moderation queue
  - Rating UI (star rating per template)
  - Filter: show community vs built-in vs pending moderation
  - "Export My Templates" button
- [M] i18n: 12 new keys
- [M] Tests: upgrade `tests/unit/communityTemplateService.test.ts` (JSON schema validation, moderation queue, rating store)

**Day 13 — Plugin Seam + Usage Analytics**
- [S] New `services/pluginRegistry.ts`:
  - `PluginDescriptor` interface: `{ id, version, name, type: 'command'|'ai-tool'|'local-ai-service', entrypoint: string, permissions: string[] }`
  - `PluginRegistry` class: `register(descriptor)`, `unregister(id)`, `list()`, `getByType(type)`
  - JSON-Registry pattern: reads from `~/.storycraft/plugins/*.json` (Tauri) or IndexedDB (web)
  - Plugin API surface: exported types in `types/plugin.ts`
  - Plugin Dev Guide: `docs/PLUGIN-DEV-GUIDE.md` (with examples for Command + AI-Tool + Local-AI-Service extension)
- [S] New `services/usageAnalyticsService.ts`:
  - Opt-in only (Redux `settings.analytics.enabled`, default false)
  - Events: AI provider selected, local model loaded, feature flag toggled, prompt category used
  - No PII: strip all user content, only metadata (event type + timestamp + device class)
  - Storage: IndexedDB ring buffer (last 500 events)
  - Export: `getAnonymizedSummary(): AnalyticsSummary` (aggregated counts only)
  - UI toggle in Settings → Privacy
- [M] i18n: 10 new keys (analytics toggle, plugin registry labels)
- [M] Tests: `tests/unit/pluginRegistry.test.ts`; `tests/unit/usageAnalyticsService.test.ts` (opt-in enforcement, PII strip, ring buffer eviction)

**Day 14 — Documentation + Coverage Push + Final QA**
- [M] Update `README.md`: add "Local-AI Architecture" section with ASCII diagram of 4-layer fallback; update feature list with StyleTransfer, Plot-Hole-Fixer, Chapter Auto-Gen, Character Arc
- [M] Update `ROADMAP.md`: mark all v1.5 items complete; add v2.0 RTL + multi-language items
- [M] Update `TODO.md`: close all Sprint items; add Plugin API v1 + RTL as v2.0
- [M] Update `CHANGELOG.md`: full v1.5 entry
- [S] Update `AUDIT.md`: add security audit for new AI services (input sanitization, cache invalidation, IDB encryption scope), performance audit (inference timeout budgets, cache hit rates)
- [M] Update `CLAUDE.md`: expand Best-Practices section for Local-AI (WorkerBus patterns, GPU mutex usage, progress emitter subscribe pattern, inference cache invalidation rules)
- [M] New `docs/CONTRIBUTOR-QUICKSTART.md`: dev env setup, branching, test requirements, local AI mock patterns
- [S] New `docs/PLUGIN-DEV-GUIDE.md`: extension points, PluginDescriptor interface, example plugin (command + AI tool)
- [S] RTL infrastructure: add `dir="rtl"` toggle to `I18nContext.tsx`, add Arabic/Hebrew placeholder locale structure (empty JSON files for future translation), CSS: add `[dir="rtl"] .manuscript-editor { text-align: right; }`
- [M] Coverage push: target branches → 55%
  - Add tests for the 9 Stryker-monitored files (currently NoCoverage): `codexService.ts`, `dbMigration.ts`, `fuzzyScore.ts`, `palettePreferences.ts`, `commandBuilder.ts`, `hybridFallback.ts`, `providerFactory.ts`, `helpDocRetrieval.ts`, `listenerMiddleware.ts`
  - Each: minimum 5 unit tests covering main branches
- [M] Run full quality gate: `pnpm run lint && pnpm run i18n:check && pnpm run typecheck && pnpm run test:run && pnpm run test:coverage && pnpm run build`

---

## Per-Component Detailed Breakdown

### Phase 1.4.1 — WorkerBus Upgrade
**Files:** `packages/ai-core/src/index.ts`
**SMART Goal:** WorkerBus handles 100 concurrent inference tasks without memory leak; priority preemption measurable in <1ms overhead.
**Sub-tasks (est. hours):**
1. Add `MAX_CONCURRENT = 3`, `MAX_QUEUE_SIZE = 32` constants (0.5h)
2. Add `private inFlight = 0` counter + `backpressure()` check (0.5h)
3. Add preemption: in `enqueue()`, if priority is critical and `low.length > 0`, splice interrupted task back (1h)
4. Upgrade `WorkerBusTelemetry` interface: add `peakLatencyMs`, `errorRate`, `lastSuccessAt` (0.5h)
5. Add `taskAbortControllers: Map<string, AbortController>` + `cancel(taskId)` (1h)
6. Tests: 6 new test cases in `aiCoreWorkerBus.test.ts` (2h)
**Total:** ~5.5h
**Failure Modes:**
- Preemption causes task starvation for low-priority → Mitigation: max 3 preemptions per task then auto-promote to normal
- AbortController map leaks → Mitigation: clean map entry in `recordResult()` + `cancel()`
- Backpressure rejects critical tasks → Mitigation: skip backpressure check for `critical` priority

### Phase 1.4.2 — GpuResourceManager
**Files:** `services/ai/gpuResourceManager.ts` (new), `services/ai/index.ts` (re-export)
**SMART Goal:** Zero WebGPU VRAM collisions across webllm + onnx-webgpu consumers; max 30s acquire timeout.
**Sub-tasks:**
1. Define `GpuConsumer = 'webllm' | 'onnx-webgpu'` type (0.25h)
2. Implement mutex: `currentConsumer`, `queue: {consumer, priority, resolve}[]` (1.5h)
3. `acquireGpu()`: if free → set current + resolve; else → push to queue sorted by priority (1h)
4. `releaseGpu()`: clear current → sort queue by priority → grant next (0.5h)
5. Auto-release timeout: `setTimeout 30000` set on acquire, cleared on release (0.5h)
6. Tests: `gpuResourceManager.test.ts` — 8 tests (sequential acquire, priority sort, timeout, multi-consumer race) (2h)
**Total:** ~5.75h
**Failure Modes:**
- Deadlock if acquirer throws before release → Mitigation: try-finally in all callers; auto-timeout
- Priority inversion when queue re-sorts → Mitigation: sort DESC on priority at dequeue, not enqueue

### Phase 1.4.7 — Download Progress Modal (WCAG AA)
**Files:** `components/settings/LocalAiDownloadProgress.tsx` (new), `services/ai/inferenceProgressEmitter.ts` (new)
**SMART Goal:** 0 WCAG 2.2 violations (Lighthouse accessibility ≥ 0.95); progress updates announced ≤ 2s intervals.
**WCAG Checklist:**
- `role="progressbar"` with `aria-valuenow={Math.round(progress*100)}` ✓
- `aria-valuemin="0" aria-valuemax="100"` ✓
- `aria-valuetext="42% heruntergeladen, ca. 30 Sekunden verbleibend"` (locale-aware) ✓
- `aria-live="polite"` on status text (throttled to 2s to avoid spam) ✓
- `aria-live="assertive"` on error message ✓
- Cancel button: `aria-label` = i18n key ✓
- Focus on modal open: `autoFocus` on cancel button ✓
- `role="dialog" aria-modal="true" aria-labelledby="modal-title"` ✓
**Performance Budget:** Progress emitter update < 1ms (pub/sub, no Redux dispatch needed)

### Phase 1.5.3 — BottomSheet Component
**Files:** `components/ui/BottomSheet.tsx` (new), `components/writing/WriterViewUI.tsx` (modify)
**SMART Goal:** BottomSheet renders in < 16ms (1 frame); focus trap passes WCAG 2.2; drag dismiss works on Pixel 5 (393×851px).
**Touch Handling:**
- `onPointerDown`: record start Y + `setPointerCapture`
- `onPointerMove`: translate sheet Y by delta, clamp to 0..height
- `onPointerUp`: if delta > 30% height → close; else snap back (CSS transition 300ms ease-out)
- `touch-action: none` on drag handle to prevent scroll
**Focus Trap:** Use `FocusTrap` from `@radix-ui/react-focus-trap` (already in deps via Radix primitives) or implement with `TreeWalker`

### Phase 2.1 — Prompt Library
**Files:** `services/promptLibrary.ts` (new), `services/geminiService.ts` (migrate 17 prompts), `components/settings/PromptLibraryPanel.tsx` (new)
**Key architectural decision:** All 17 existing `buildPrompt_X()` functions in `geminiService.ts` are migrated to `PromptTemplate` objects. `geminiService.ts` calls `promptLibrary.getPrompt(id, vars)`. No external API change — all callers unchanged.
**Versioning:** Template `version: '1.0.0'` bumped when prompt changes. Old prompts cached in IDB with version key for cache invalidation.
**A/B testing:** `abTestVariants?: PromptTemplate[]` — `getPrompt()` randomly selects from variants (50/50); selection logged to `usageAnalyticsService` if analytics enabled.

---

## Critical Files to Create (in order)

```
packages/ai-core/src/index.ts                          MODIFY (WorkerBus v2)
src/workers/inference.worker.ts                        CREATE
services/ai/gpuResourceManager.ts                      CREATE
services/ai/deviceHealthService.ts                     CREATE
services/ai/ecoModeService.ts                          CREATE
services/ai/inferenceProgressEmitter.ts                CREATE
services/ai/aiInferenceCacheService.ts                 CREATE
services/ai/localEmbeddingService.ts                   CREATE
services/ai/localNlpService.ts                         CREATE
services/ai/modelRecommendations.ts                    MODIFY (dynamic recommendation)
services/promptLibrary.ts                              CREATE
services/localRagService.ts                            RENAME+UPGRADE from localRagIndex.ts
services/pluginRegistry.ts                             CREATE
services/usageAnalyticsService.ts                      CREATE
services/crossProjectIndexService.ts                   MODIFY (AI enrichment)
services/geminiService.ts                              MODIFY (new prompts + promptLibrary delegation)
components/ui/BottomSheet.tsx                          CREATE
components/settings/LocalAiDownloadProgress.tsx        CREATE
components/settings/GpuMetricsPanel.tsx                CREATE
components/settings/PromptLibraryPanel.tsx             CREATE
components/settings/AiSections.tsx                     MODIFY (wire progress + metrics)
components/StyleTransferView.tsx                       CREATE
components/ChapterAutoGenView.tsx                      CREATE
components/CharacterArcVisualizerView.tsx              CREATE
hooks/useSwipeGesture.ts                               CREATE
hooks/useLongPress.ts                                  CREATE
hooks/useHaptics.ts                                    CREATE
hooks/useStyleTransferView.ts                          CREATE
hooks/useChapterAutoGenView.ts                         CREATE
hooks/useCharacterArcVisualizerView.ts                 CREATE
contexts/StyleTransferContext.tsx                      CREATE
contexts/ChapterAutoGenContext.tsx                     CREATE
contexts/CharacterArcVisualizerContext.tsx             CREATE
components/writing/WriterViewUI.tsx                    MODIFY (swipe gesture, BottomSheet)
components/ManuscriptView.tsx                          MODIFY (PointerEvent resize)
features/featureFlags/featureFlagsSlice.ts             MODIFY (add enableChapterAutoGen, enableCharacterArcVisualizer, enablePromptLibrary, enablePluginRegistry, enableUsageAnalytics)
App.tsx                                                MODIFY (lazy-load 3 new views)
types/plugin.ts                                        CREATE
types.ts                                               MODIFY (new shared interfaces)
locales/*/settings.json                                MODIFY (all 5 locales, ~35 new keys)
locales/*/common.json                                  MODIFY (all 5 locales, ~20 new keys)
locales/*/writer.json                                  MODIFY (all 5 locales, ~15 new keys)
```

**New test files (all in tests/unit/ or tests/e2e/):**
```
tests/unit/aiCoreWorkerBus.test.ts                     MODIFY (backpressure, preemption, cancel)
tests/unit/gpuResourceManager.test.ts                  CREATE
tests/unit/deviceHealthService.test.ts                 CREATE
tests/unit/inferenceProgressEmitter.test.ts            CREATE
tests/unit/aiInferenceCacheService.test.ts             CREATE
tests/unit/localEmbeddingService.test.ts               CREATE
tests/unit/localNlpService.test.ts                     CREATE
tests/unit/inferenceWorker.test.ts                     CREATE
tests/unit/aiCoreFallbackPaths.test.ts                 MODIFY (real ONNX/Transformers paths)
tests/unit/localRagService.test.ts                     RENAME+UPGRADE
tests/unit/promptLibrary.test.ts                       CREATE
tests/unit/communityTemplateService.test.ts            MODIFY (validation, rating, moderation)
tests/unit/pluginRegistry.test.ts                      CREATE
tests/unit/usageAnalyticsService.test.ts               CREATE
tests/unit/useSwipeGesture.test.ts                     CREATE
tests/unit/useLongPress.test.ts                        CREATE
tests/unit/settings/LocalAiDownloadProgress.test.tsx   CREATE
tests/unit/settings/GpuMetricsPanel.test.tsx           CREATE
tests/unit/settings/PromptLibraryPanel.test.tsx        CREATE
tests/unit/BottomSheet.test.tsx                        CREATE
tests/unit/StyleTransferView.test.tsx                  CREATE
tests/unit/ChapterAutoGenView.test.tsx                 CREATE
tests/unit/CharacterArcVisualizerView.test.tsx         CREATE
tests/e2e/mobile-touch.spec.ts                         CREATE
```

---

## Reuse Checklist (Existing Utilities)

- `sanitizeForPrompt()` — ai-core/index.ts:120. Use for ALL new AI prompt inputs
- `detectWebGpuDetails()` — services/ai/webGpuDetectorService.ts. Feed into `deviceHealthService`
- `WorkerBus` class — ai-core/index.ts:45. Use in `localEmbeddingService`, `localNlpService`, `localRagService`
- `electSingleHeavyInferenceTab()` — ai-core/tabLeaderElection.ts. Keep; complement with `gpuResourceManager`
- `dbService.ts` — Use existing IDB dual-DB for `aiInferenceCacheService` (store in `storycraft-data-db`)
- `assertCloudAiAllowed()` — services/ai/aiPolicy.ts. Call before any cloud AI tool dispatch
- `resolveProviderFallbackChain()` — services/ai/hybridFallback.ts. Still used by orchestration layer
- `useTranslation()` — hooks/useTranslation.ts. ALL new UI strings
- `useAppDispatch/Selector` — app/hooks.ts. ALL new hooks
- `APP_SECTIONS` — constants/sections.tsx. Add new views (StyleTransfer, ChapterAutoGen, CharacterArc)
- `SectionIcon` — components/ui/SectionIcon.tsx. Apply to all 3 new view headers
- `FocusTrap` / modal pattern — existing Modal.tsx. Reuse for BottomSheet focus management

---

## Verification Plan

### After each major day block:
```bash
pnpm run lint && pnpm run i18n:check && pnpm run typecheck
pnpm exec vitest run <specific test file>
```

### After Day 6 (end of Week 1):
```bash
pnpm run lint && pnpm run i18n:check && pnpm run typecheck && pnpm run test:run && pnpm run test:coverage && pnpm run build && pnpm run bundle:budget
```
Target: branches coverage ≥ 48%, statements ≥ 64%

### After Day 14 (final):
```bash
pnpm run lint && pnpm run i18n:check && pnpm run typecheck && pnpm run test:run && pnpm run test:coverage && pnpm run build && pnpm run bundle:budget
# Then (in separate terminal or CI):
pnpm run test:e2e  # Mobile Chrome Pixel 5
pnpm run storybook
```
Target: branches ≥ 55%, statements ≥ 67%, Lighthouse ≥ 0.95

### WCAG Audit Plan:
- Run `pnpm run test:e2e` with `a11y.spec.ts` — currently covers all views via axe-core
- New views (StyleTransfer, ChapterAutoGen, CharacterArc) must be added to `a11y.spec.ts`
- `LocalAiDownloadProgress` WCAG checklist: verify all ARIA attributes in `LocalAiDownloadProgress.test.tsx`
- `BottomSheet` focus trap: verify with `BottomSheet.test.tsx` userEvent keyboard navigation

### Security Audit:
- `inference.worker.ts`: verify `isTrustedWorkerMessage()` checks origin before processing
- `aiInferenceCacheService.ts`: confirm inference results stored encrypted (or in-memory only for sensitive content)
- `promptLibrary.ts`: verify import validation uses zod/JSON schema before executing
- `pluginRegistry.ts`: confirm plugins cannot access Redux store directly (only via exported API)
- `usageAnalyticsService.ts`: verify PII strip: all user text excluded, only event metadata

### Performance Budgets:
- Inference timeout: WebLLM 45s desktop / 20s mobile; Transformers.js ONNX 30s desktop / 15s mobile
- Embedding: all-MiniLM-L6-v2 inference < 2s desktop; < 5s mobile
- Cache lookup: < 10ms (in-memory LRU)
- WorkerBus enqueue + priority sort: < 1ms for 100 concurrent tasks
- BottomSheet animation: CSS 300ms ease-out (no JS animation loop)
- New Vite chunks: `vendor-ai-worker` (inference.worker.ts deps ≤ 15 MB), existing `vendor-ai-onnx` unchanged

### Git Workflow:
- Branch: `feat/v1.5-master-perfection`
- Commit prefix: `feat(local-ai):`, `feat(mobile):`, `feat(prompt-lib):`, `feat(templates):`, `feat(plugins):`, `docs:`, `test:`
- All commits: conventional commits + QNBS-v3 comments on non-trivial code changes
- PR: single `[v1.5] Master Perfection Run` PR with full description referencing this plan

---

## Self-Consistency Check

**Architectural completeness:**
- ✅ All 4 layers active (Ollama Layer-0 already in fetchAdapter; Layer-1 WebLLM ready; Layer-2 ONNX activated; Layer-3 Transformers.js activated; Layer-4 Heuristic fixed)
- ✅ GPU mutex prevents VRAM collision between webllm + onnx-webgpu
- ✅ Device health drives model recommendation → no more one-size-fits-all
- ✅ Inference cache reduces redundant model calls by estimated 40-60%
- ✅ All new UI: WCAG 2.2 AA (ARIA, focus trap, live regions)
- ✅ All new strings: i18n (5 locales)
- ✅ All new code: unit tests first (TDD order)
- ✅ No breaking changes (backward compat on `searchLocalRag()`, `runLocalTextGeneration()`)
- ✅ View pattern enforced: components/X.tsx + hooks/useXView.ts + contexts/XContext.tsx for all 3 new views
- ✅ Feature flags for all experimental features (enableChapterAutoGen, enableCharacterArcVisualizer, enablePromptLibrary, enablePluginRegistry, enableUsageAnalytics)
- ✅ Coverage target: 55% branches achievable with 24 new test files
