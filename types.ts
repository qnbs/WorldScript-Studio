import type { Type } from '@google/genai';
import type { EntityState } from '@reduxjs/toolkit';
import type { ProjectData } from './features/project/projectSlice'; // Import ProjectData type

export type View =
  | 'dashboard'
  | 'manuscript'
  | 'writer'
  | 'templates'
  | 'outline'
  | 'characters'
  | 'world'
  | 'export'
  | 'settings'
  | 'help'
  | 'sceneboard'
  | 'analytics'
  | 'zen'
  | 'characterGraph'
  | 'consistencyChecker'
  | 'critic'
  | 'preview'
  | 'progress'
  | 'objects'
  | 'mindmap'
  | 'characterInterviews'
  | 'lora';

export interface Character {
  id: string;
  name: string;
  backstory: string;
  motivation: string;
  appearance: string;
  personalityTraits: string;
  flaws: string;
  notes: string;
  hasAvatar?: boolean;
  characterArc: string;
  relationships: string;
}

export interface CharacterRelationship {
  id: string;
  fromCharacterId: string;
  toCharacterId: string;
  type: 'family' | 'romantic' | 'friend' | 'enemy' | 'mentor' | 'rival' | 'ally' | 'acquaintance';
  description?: string;
  strength: number; // 1-10
}

export interface WorldLocation {
  id: string;
  name: string;
  description: string;
  coordinates?: { lat: number; lng: number };
  type: 'city' | 'village' | 'forest' | 'mountain' | 'castle' | 'temple' | 'other';
  population?: number;
  significance?: string;
}

export interface WorldTimelineEvent {
  id: string;
  era: string;
  year?: number;
  title: string;
  description: string;
  date?: string; // ISO date string
  locationId?: string;
  characterIds?: string[];
}

export interface WritingSession {
  id: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  wordsWritten: number;
  sectionId?: string;
  notes?: string;
}

export interface World {
  id: string;
  name: string;
  description: string;
  geography: string;
  magicSystem: string;
  culture: string;
  notes: string;
  hasAmbianceImage?: boolean;
  timeline: WorldTimelineEvent[];
  locations: WorldLocation[];
  relationships?: CharacterRelationship[]; // Character relationships in this world
}

// --- Story Objects & Groups (Phase 1 — v1.7) ---

export type StoryObjectType =
  | 'prop'
  | 'weapon'
  | 'vehicle'
  | 'artifact'
  | 'document'
  | 'place-item'
  | 'other';

export interface StoryObject {
  id: string;
  name: string;
  description: string;
  type: StoryObjectType;
  groupIds: string[];
  characterIds?: string[];
  sceneIds?: string[];
  significance?: string;
  notes?: string;
  imageAssetId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ObjectGroup {
  id: string;
  name: string;
  description?: string;
  color: string; // #hex
  objectIds: string[];
  createdAt: string;
  updatedAt: string;
}

// --- Mind Maps (Phase 2 — v1.7) ---

export type MindMapNodeType = 'free' | 'linked';
export type MindMapLinkedEntityType = 'character' | 'world' | 'object' | 'group' | 'scene';
export type MindMapNodeShape = 'circle' | 'rectangle' | 'diamond' | 'ellipse' | 'hexagon';
export type MindMapEdgeStyle = 'solid' | 'dotted';
export type MindMapEdgeDirection = 'uni' | 'bi';

export interface MindMapNode {
  id: string;
  mindMapId: string;
  label: string;
  type: MindMapNodeType;
  linkedEntityType?: MindMapLinkedEntityType;
  linkedEntityId?: string;
  position: { x: number; y: number };
  color: string;
  shape: MindMapNodeShape;
  profileImageUrl?: string;
  textNotes: string;
  createdAt: string;
  updatedAt: string;
}

export interface MindMapEdge {
  id: string;
  mindMapId: string;
  sourceNodeId: string;
  targetNodeId: string;
  label?: string;
  color: string;
  style: MindMapEdgeStyle;
  direction: MindMapEdgeDirection;
  createdAt: string;
}

export interface MindMap {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  nodes: MindMapNode[];
  edges: MindMapEdge[];
  viewport?: { x: number; y: number; zoom: number };
  createdAt: string;
  updatedAt: string;
}

// ── Character Interviews ──────────────────────────────────────────────────────

export type CharacterArchetype =
  | 'hero'
  | 'mentor'
  | 'villain'
  | 'shadow'
  | 'trickster'
  | 'shapeshifter'
  | 'herald'
  | 'ally'
  | 'threshold-guardian';

export interface InterviewMessage {
  id: string;
  role: 'user' | 'ai';
  content: string;
  timestamp: string;
}

export interface CharacterInterview {
  id: string;
  characterId: string;
  archetype: CharacterArchetype;
  templateId: string;
  title?: string;
  messages: InterviewMessage[];
  createdAt: string;
  updatedAt: string;
}

// ── Binder ────────────────────────────────────────────────────────────────────

/** Hierarchical research / reference tree (Binder); stored with project data. */
export type BinderNodeType = 'folder' | 'text' | 'note' | 'image' | 'pdf' | 'link';

export interface BinderNode {
  id: string;
  parentId: string | null;
  type: BinderNodeType;
  title: string;
  linkedSectionId?: string;
  content?: string;
  /** Legacy/small images may use character-style image store; binder blobs prefer `binderAssetId`. */
  imageAssetId?: string;
  /** Unified blob key for PDF/image/audio in StorageBackend binder asset API. */
  binderAssetId?: string;
  /** External reference (no blob). */
  linkUrl?: string;
  mimeType?: string;
  byteSize?: number;
  originalFileName?: string;
  sortIndex: number;
}

export interface StorySection {
  id: string;
  title: string;
  content: string;
  prompt?: string;
  summary?: string;
  notes?: string;
  color?: string; // For scene board cards
  position?: { x: number; y: number }; // For scene board positioning
  characterIds?: string[]; // Linked characters
  worldIds?: string[]; // Linked worlds
  wordCount?: number;
  status?: 'draft' | 'outline' | 'first-draft' | 'revised' | 'final';
  act?: 1 | 2 | 3; // Act membership for swimlanes
  /** In-universe scene start (ISO-like or story-calendar string). */
  sceneStart?: string;
  /** Human-readable duration (e.g. PT2H, "3 days"). */
  sceneDuration?: string;
  /** Links to WorldLocation.id when places are modeled. */
  sceneLocationId?: string;
  /** Primary POV character for analytics. */
  povCharacterId?: string;
}

/** Compile front/back matter (Scrivener-style), stored with project. */
export interface CompileMatterBlock {
  id: string;
  title: string;
  bodyMarkdown: string;
}

export interface CompileProfile {
  titlePageMarkdown?: string;
  dedicationMarkdown?: string;
  imprintMarkdown?: string;
  acknowledgementsMarkdown?: string;
  /** Ordered sections inserted before/after manuscript at export. */
  frontMatter?: CompileMatterBlock[];
  backMatter?: CompileMatterBlock[];
}

export interface StoryProject {
  title: string;
  logline: string;
  author?: string;
  characters: Character[] | EntityState<Character, string>;
  worlds: World[] | EntityState<World, string>;
  outline?: OutlineSection[];
  manuscript: StorySection[];
  /** Optional research binder (feature-flagged UI). */
  binderNodes?: BinderNode[];
  /** Export / compile metadata (title page, imprint, Normseiten tuning). */
  compileProfile?: CompileProfile;
  projectGoals?: {
    totalWordCount: number;
    targetDate: string | null;
  };
  writingHistory?: {
    date: string; // YYYY-MM-DD
    words: number;
  }[];
}

export interface StoryCodexMention {
  sectionId: string;
  sectionTitle: string;
  excerpt: string;
  count: number;
}

export interface StoryCodexEntity {
  id: string;
  name: string;
  type: 'character' | 'world' | 'location' | 'object' | 'event' | 'unknown';
  known: boolean;
  mentionCount: number;
  canonicalId?: string | undefined;
  mentions: StoryCodexMention[];
}

export interface StoryCodex {
  projectId: string;
  extractedAt: string;
  entities: StoryCodexEntity[];
  summary: string;
  /** Co-mention edges between entities (Story Bible advanced). */
  relationshipEdges?: StoryCodexRelationshipEdge[];
  /** Rule-based consistency hints (Story Bible advanced). */
  consistencyHints?: StoryCodexConsistencyHint[];
}

/** Undirected co-appearance edge derived from shared scene/section mentions. */
export interface StoryCodexRelationshipEdge {
  sourceEntityId: string;
  targetEntityId: string;
  weight: number;
  sectionIds: string[];
}

export interface StoryCodexConsistencyHint {
  id: string;
  severity: 'info' | 'warn';
  message: string;
  entityIds?: string[];
}

export interface Template {
  id: string;
  name: string;
  description: string;
  type: 'Genre' | 'Structure';
  tags: string[];
  arcDescription: string;
  sections: { titleKey: string }[];
}

export interface OutlineSection {
  id: string;
  title: string;
  description: string;
  isTwist?: boolean;
}

// Settings Types
export type Theme = 'dark' | 'light' | 'auto';
/** Creative appearance presets — map to `body` classes in App (`.appearance-sepia`). */
export type AppearancePreset = 'default' | 'sepia';
/**
 * AI execution mode — controls whether requests are routed to cloud providers,
 * local on-device models, or resolved automatically (hybrid smart routing).
 * Mirrors the CannaGuide-2025 AiMode pattern (localRoutingService ADR).
 */
export type AiMode = 'hybrid' | 'cloud' | 'local' | 'eco';
export type EditorFont = 'serif' | 'sans-serif' | 'monospace' | 'custom';
export type AiCreativity = 'Focused' | 'Balanced' | 'Imaginative';
export type AiModel =
  // Gemini – latest generation (3.x)
  | 'gemini-3.5-flash'
  | 'gemini-3.1-pro-preview'
  | 'gemini-3.1-flash'
  | 'gemini-3.1-flash-lite'
  // Gemini – 2.5 stable (backward compat for stored values)
  | 'gemini-2.5-flash'
  | 'gemini-2.5-pro'
  // Gemini – legacy (backward compat for stored values)
  | 'gemini-2.0-flash'
  | 'gemini-2.0-flash-lite'
  | 'gemini-1.5-flash'
  | 'gemini-1.5-pro'
  // Anthropic – Claude 4.x
  | 'claude-opus-4-7'
  | 'claude-sonnet-4-6'
  | 'claude-haiku-4-5'
  // Anthropic – Claude 3.x (backward compat for stored values)
  | 'claude-3-sonnet'
  | 'claude-3-haiku'
  // OpenAI
  | 'gpt-4o'
  | 'gpt-4o-mini'
  // Grok (xAI)
  | 'grok-3'
  | 'grok-3-mini'
  // Ollama – any local model (e.g. "ollama/gemma3" or "ollama/qwen3:8b")
  | `ollama/${string}`
  // WebLLM – specific MLC-packaged checkpoints (see WEBLLM_SUPPORTED_MODELS in @domain/ai-core)
  | 'Llama-3.2-1B-Instruct-q4f16_1-MLC'
  | 'Llama-3.2-3B-Instruct-q4f16_1-MLC'
  | 'Phi-3.5-mini-instruct-q4f16_1-MLC'
  | 'gemma-2-2b-it-q4f16_1-MLC'
  // QNBS-v3: Qwen 2.5 added in v1.5 WEBLLM_SUPPORTED_MODELS — keep AiModel in sync.
  | 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC'
  /** Browser-only WebGPU path via @mlc-ai/web-llm (generic fallback for stored values). */
  | 'webllm/browser'
  // ONNX Runtime Web — WASM CPU/GPU inference (see ONNX_SUPPORTED_MODELS in @domain/ai-core)
  | 'HuggingFaceTB/SmolLM2-135M-Instruct'
  | 'Xenova/distilgpt2'
  | 'Xenova/gpt2'
  // Transformers.js — any Xenova-compatible HuggingFace model
  | `Xenova/${string}`;
export type AIProvider =
  | 'gemini'
  | 'openai'
  | 'anthropic'
  | 'grok'
  | 'ollama'
  /** OpenRouter — unified OpenAI-compatible gateway with free-tier models and many open-source providers. */
  | 'openrouter'
  /** Fully in-browser inference (WebLLM / Transformers.js stack in @domain/ai-core). */
  | 'webllm'
  /** ONNX Runtime Web — CPU/WASM inference, no API key needed. */
  | 'onnx'
  /** Transformers.js — Xenova/HuggingFace WASM/WebGPU inference. */
  | 'transformers';
/**
 * Per-project AI preset — overrides global advancedAi settings for this project only.
 * When enabled, buildAiOptions() merges these values over the global settings.
 * LoRA fields are preparatory (webllm/onnx/transformers layer accepts them; actual
 * weight loading is handled by localAiFacade once LoRA adapters are bundled).
 */
// QNBS-v3: exactOptionalPropertyTypes requires explicit `| undefined` so patch calls can clear fields.
export interface ProjectAiPreset {
  enabled: boolean;
  provider?: AIProvider | undefined;
  model?: AiModel | undefined;
  creativity?: AiCreativity | undefined;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  /** Optional system-prompt override injected before the standard story prompts. */
  customSystemPrompt?: string | undefined;
  /** Path/id of a LoRA adapter compatible with the selected local model (future). */
  loraModelPath?: string | undefined;
  /** Adapter scale α (0–2, default 1.0). Controls LoRA influence strength. */
  loraScale?: number | undefined;
}

export type BackupFrequency = 'manual' | 'daily' | 'weekly' | 'monthly';

export interface CustomFont {
  name: string;
  url: string;
  format: 'woff' | 'woff2' | 'ttf' | 'otf';
}

export interface KeyboardShortcut {
  id: string;
  keys: string[];
  action: string;
}

export interface WritingGoal {
  id?: string;
  type: 'words' | 'time' | 'sessions' | 'daily' | 'weekly' | 'monthly' | 'total';
  target: number;
  current?: number;
  period: 'daily' | 'weekly' | 'monthly' | string;
  achieved?: boolean;
  enabled?: boolean;
}

/** Lokales OpenAI-kompatibles Backend — Preset setzt nur Default-URL (LM Studio, vLLM, …). */
export type LocalBackendPreset = 'ollama_default' | 'lm_studio' | 'vllm' | 'custom';

export interface AdvancedAiSettings {
  model: AiModel;
  provider: AIProvider;
  temperature: number;
  maxTokens: number;
  topP: number;
  frequencyPenalty: number;
  presencePenalty: number;
  customPrompts: Record<string, string>;
  rateLimit: number; // requests per minute
  ollamaBaseUrl: string;
  /** Preset for local /v1 servers; switching sets the typical base URL (custom = manual URL). */
  localBackendPreset: LocalBackendPreset;
  /**
   * OpenAI-compatible cloud or proxy API (OpenRouter, Groq, …): root without path, e.g. `https://openrouter.ai/api`.
   * Empty = official OpenAI API (`api.openai.com`).
   */
  openAiCompatibleBaseUrl: string;
  /** Optional for OpenRouter rankings / attribution (HTTP Referer header). */
  openAiSiteUrl: string;
  /** Optional for OpenRouter (X-Title header). */
  openAiSiteTitle: string;
  /** Try additional providers after the primary provider on error (project thunks / legacy streaming). */
  hybridFallbackEnabled: boolean;
  /** Order of fallback providers (no duplicates; primary always comes first). */
  hybridFallbackChain: AIProvider[];
  // QNBS-v3: lexical = fast BoW only; hybrid = semantic MiniLM + lexical token-overlap + recency (default).
  ragMode: 'lexical' | 'hybrid';
}

export type AccessibilityPresetId = 'custom' | 'motor' | 'lowVision' | 'cognitive' | 'screenReader';

export type LiveRegionVerbosity = 'minimal' | 'normal' | 'verbose';

export interface AccessibilitySettings {
  highContrast: boolean;
  reducedMotion: boolean;
  largeText: boolean;
  screenReader: boolean;
  focusIndicators: boolean;
  colorBlindMode: 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia';
  /** Last applied accessibility preset (manual tweaks set this to custom). */
  presetId: AccessibilityPresetId;
  /** Controls non-critical screen reader announcements (view titles always announce). */
  liveRegionVerbosity: LiveRegionVerbosity;
  /** Larger minimum tap targets (motor comfort). */
  comfortableTargets: boolean;
}

export interface PrivacySettings {
  analyticsEnabled: boolean;
  dataEncryption: boolean;
  localStorageOnly: boolean;
  euDataResidency: boolean;
  // QNBS-v3: SEC one-time migration marker. Before the analytics gate existed, analyticsEnabled was
  // cosmetic (persistence was controlled solely by enableDuckDbAnalytics, default on), so legacy
  // persisted settings hold a meaningless value. On the first load after the gate ships we reset
  // analyticsEnabled to the new default to preserve prior behavior, then set this flag so the user's
  // real choice is respected on every subsequent load. Optional for back-compat with old payloads.
  analyticsGateMigrated?: boolean;
}

export interface CollaborationSettings {
  /** WebRTC signaling URLs (wss:// or ws://), one per line in UI; empty uses built-in defaults. */
  webrtcSignalingUrls: string[];
}

export interface IntegrationSettings {
  /** Opt-in: nur eigener LanguageTool-Server (typ. localhost) — kein stiller Cloud-Upload. */
  languageToolEnabled: boolean;
  languageToolBaseUrl: string;
}

export interface AdvancedEditorSettings {
  autoComplete: boolean;
  spellCheck: boolean;
  grammarCheck: boolean;
  wordCount: boolean;
  readingTime: boolean;
  distractionFree: boolean;
  typewriterMode: boolean;
  zenMode: boolean;
  focusMode: boolean;
  customDictionary: string[];
  writingStats: boolean;
}

export interface BackupSettings {
  autoBackup: boolean;
  backupFrequency: BackupFrequency;
  backupLocation: string;
  maxBackups: number;
  encryptBackups: boolean;
}

export interface ThemeCustomization {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  customCss: string;
}

// ── Voice Full Support (opt-in) ──────────────────────────────────────────────

export type VoiceSttEngine = 'whisper' | 'webSpeech' | 'auto';
export type VoiceTtsEngine = 'kokoro' | 'piper' | 'webSpeech' | 'auto';
export type VoiceFeedbackLevel = 'minimal' | 'standard' | 'verbose';
export type VoiceActivationMode = 'pushToTalk' | 'wakeWord' | 'manual';

export interface VoiceSettings {
  /** Master toggle — Voice Full Support opt-in */
  enabled: boolean;
  /** How voice is activated: PTT key, wake-word, or manual button */
  activationMode: VoiceActivationMode;
  /** Primary speech-to-text engine preference */
  sttEngine: VoiceSttEngine;
  /** Primary text-to-speech engine preference */
  ttsEngine: VoiceTtsEngine;
  /** Audio feedback verbosity */
  feedbackLevel: VoiceFeedbackLevel;
  /** TTS speech rate (0.5 - 2.0) */
  speechRate: number;
  /** TTS speech volume (0.0 - 1.0) */
  speechVolume: number;
  /** Allow cloud STT fallback when local engines unavailable */
  allowCloudSttFallback: boolean;
  /** Continuous listening timeout in seconds (5-30) */
  listeningTimeoutSeconds: number;
  /** Wake-word phrase (default: "Hey WorldScript") */
  wakeWordPhrase: string;
  /** Push-to-talk keyboard shortcut (stored as action id) */
  pttShortcutId: string;
  /** Mute all TTS output */
  ttsMuted: boolean;
  /** Dictation auto-punctuation */
  dictationAutoPunctuation: boolean;
  /** GDPR Art. 13 consent granted for Web Speech API (routes audio to cloud STT providers) */
  webSpeechConsentGranted?: boolean;
  /** WASM voice models download progress (0-1) */
  wasmModelDownloadProgress?: number;
  /** WASM voice models ready for use */
  wasmModelsReady?: boolean;
  /** WASM voice model download error message */
  voiceWasmDownloadError?: string;
}

/** OpenRouter provider settings — key stored encrypted, model controls free-vs-paid selection. */
export interface OpenRouterSettings {
  /** Whether OpenRouter is enabled as a provider in the routing chain. */
  enabled: boolean;
  /**
   * OpenRouter API key (encrypted at rest via IDB AES-256-GCM when enableIdbAtRestEncryption is on).
   * Never logged; sanitizeLogContext redacts it automatically.
   */
  apiKey: string;
  /**
   * Preferred model identifier. Use `:free` suffix for the free tier
   * (e.g. `"deepseek/deepseek-r1:free"`, `"meta-llama/llama-3.3-70b-instruct:free"`).
   */
  preferredModel: string;
}

/** QNBS-v3 (T2): Desktop-only (Tauri) behavior. Ignored on the web. Extended by later native phases. */
export interface DesktopSettings {
  /** Hide to the system tray on window close instead of quitting. */
  minimizeToTray: boolean;
}

export interface Settings {
  // Basic Settings
  theme: Theme;
  appearancePreset: AppearancePreset;
  /** AI execution routing mode — hybrid (default), cloud-only, local-only, or eco (tiny models). */
  aiMode: AiMode;
  /** OpenRouter cloud provider settings — enabled/disabled, API key, preferred model. */
  openRouter?: OpenRouterSettings;
  editorFont: EditorFont;
  fontSize: number;
  lineSpacing: number;
  aiCreativity: AiCreativity;
  paragraphSpacing: number;
  indentFirstLine: boolean;

  // Advanced Settings
  customFont?: CustomFont;
  keyboardShortcuts: KeyboardShortcut[];
  writingGoals: WritingGoal[];
  advancedAi: AdvancedAiSettings;
  accessibility: AccessibilitySettings;
  privacy: PrivacySettings;
  collaboration: CollaborationSettings;
  integrations: IntegrationSettings;
  advancedEditor: AdvancedEditorSettings;
  backup: BackupSettings;
  themeCustomization: ThemeCustomization;
  voice: VoiceSettings;
  desktop: DesktopSettings;

  // Legacy support
  language?: string;
}

// Help Types
export interface HelpArticle {
  title: string;
  content: string;
  /** Optional command id from the command registry (e.g. nav-manuscript). */
  tryActionId?: string;
}

// ─── Version Control Types ──────────────────────────────────────────────────

export interface VersionSnapshot {
  id: string;
  branchId: string;
  label: string;
  timestamp: string;
  manuscriptSnapshot: string; // LZ-string compressed JSON of StorySection[]
  wordCount: number;
  parentId?: string;
  /** When set, snapshot restores a single manuscript section only. */
  sectionId?: string;
}

export interface VersionBranch {
  id: string;
  name: string;
  description: string;
  color: string;
  createdAt: string;
  headSnapshotId?: string;
}

/** Serialized alongside project payload for offline persistence of branches/snapshots. */
export interface PersistedVersionControlState {
  branches: VersionBranch[];
  snapshots: VersionSnapshot[];
  currentBranchId: string;
}

// ─── Plot-Board v2 Types ─────────────────────────────────────────────────────

/** A named subplot grouping scenes by a secondary story thread. */
export interface Subplot {
  id: string;
  name: string;
  /** Hex color, e.g. "#a855f7". */
  color: string;
  sectionIds: string[];
}

export type PlotConnectionType =
  | 'cause-effect'
  | 'parallel'
  | 'subplot'
  | 'temporal'
  | 'character-arc';

/** Directed edge between two scenes on the Plot-Board canvas. */
export interface PlotConnection {
  id: string;
  fromSectionId: string;
  toSectionId: string;
  type: PlotConnectionType;
  /** When set, inherits color from the linked subplot. */
  subplotId?: string;
  label?: string;
  /** Override color (hex). Falls back to connection-type default. */
  color?: string;
}

// ─── Scene Revision + Comment Types ──────────────────────────────────────────

/** Snapshot of a single scene at a point in time (stored in IDB, not Redux). */
export interface SceneRevision {
  id: string;
  sectionId: string;
  createdAt: number; // Date.now()
  title: string;
  content: string;
  wordCount: number;
  /** User-supplied label, e.g. "Draft 2". */
  label?: string;
  authorName?: string;
}

export interface CommentReply {
  id: string;
  createdAt: number;
  authorName: string;
  authorColor: string;
  body: string;
}

/** Threaded comment anchored to a scene, optionally to a text range. */
export interface SceneComment {
  id: string;
  sectionId: string;
  createdAt: number;
  authorName: string;
  /** Hex color assigned to the author for avatar/highlight. */
  authorColor: string;
  body: string;
  resolved: boolean;
  /** Optional text selection anchor within the scene content. */
  selectionStart?: number;
  selectionEnd?: number;
  replies: CommentReply[];
}

// ─── Community Template Types ────────────────────────────────────────────────

export interface CommunityTemplate {
  id: string;
  name: string;
  description: string;
  type: 'Genre' | 'Structure';
  tags: string[];
  arcDescription: string;
  author: string;
  stars?: number;
  sections: { title: string; description?: string }[];
}

// ─── Collaboration Types ─────────────────────────────────────────────────────

export interface CollaborationUser {
  id: string;
  name: string;
  color: string;
  cursor?: number;
}

export interface CollaborationRoom {
  roomId: string;
  users: CollaborationUser[];
  isConnected: boolean;
}

export interface HelpCategory {
  id: string;
  title: string;
  icon: string;
  articles: HelpArticle[];
}

// Snapshot Types
export interface ProjectSnapshot {
  id: number;
  date: string;
  name: string;
  wordCount: number;
}

// AI Types
export interface GeminiSchema {
  type: Type;
  items?: GeminiSchema;
  properties?: Record<string, GeminiSchema>;
  required?: string[];
  description?: string;
}

export interface OutlineGenerationParams {
  genre: string;
  idea: string;
  characters?: string;
  setting?: string;
  pacing?: string;
  numChapters: number;
  includeTwist: boolean;
  lang: string;
}

export interface CustomTemplateParams {
  customConcept: string;
  customElements: string;
  numSections: number;
  lang: string;
}

// Speech Recognition Types
interface ISpeechRecognitionConstructor {
  new (): ISpeechRecognition;
}

declare global {
  interface Window {
    SpeechRecognition: ISpeechRecognitionConstructor;
    webkitSpeechRecognition: ISpeechRecognitionConstructor;
    // QNBS-v3: cross-service gate set by listenerMiddleware (adaptive-AI ON/OFF) and read by
    // localAiFacade — typed here so call sites avoid `(window as any)` casts (F-4 abatement).
    __worldscript_adaptive_ai__?: boolean;
  }
}

export interface ISpeechRecognitionEvent {
  resultIndex: number;
  results: {
    [key: number]: {
      isFinal: boolean;
      [key: number]: {
        transcript: string;
      };
    };
    length: number;
  };
}

export interface ISpeechRecognitionError {
  error: string;
  message?: string;
}

export interface ISpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: (event: ISpeechRecognitionEvent) => void;
  onend: () => void;
  onerror: (event: ISpeechRecognitionError) => void;
}

// Persistence Types
export interface PersistedRootState {
  project?: {
    present?: { data: ProjectData };
    data?: ProjectData;
    past?: unknown[];
    future?: unknown[];
    _latestUnfiltered?: unknown;
  };
  settings?: Settings;
  status?: unknown;
  writer?: unknown;
}
