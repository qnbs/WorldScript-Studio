/**
 * Core types for the StoryCraft ProForge Ultimate Author Pipeline.
 * QNBS-v3: Strict typing for the 8-stage agentic pipeline with Human-in-the-Loop gates.
 */

// ---------------------------------------------------------------------------
// Pipeline Stages
// ---------------------------------------------------------------------------

export type PipelineStage =
  | 'idle'
  | 'intake'
  | 'structural'
  | 'lineProse'
  | 'copyEdit'
  | 'proof'
  | 'production'
  | 'publishing'
  | 'analytics'
  | 'archived';

export const PIPELINE_STAGES: PipelineStage[] = [
  'idle',
  'intake',
  'structural',
  'lineProse',
  'copyEdit',
  'proof',
  'production',
  'publishing',
  'analytics',
  'archived',
];

export const EDITING_STAGES: PipelineStage[] = [
  'intake',
  'structural',
  'lineProse',
  'copyEdit',
  'proof',
];

export function isEditingStage(stage: PipelineStage): boolean {
  return EDITING_STAGES.includes(stage);
}

export function nextStage(stage: PipelineStage): PipelineStage | null {
  const idx = PIPELINE_STAGES.indexOf(stage);
  return idx >= 0 && idx < PIPELINE_STAGES.length - 1 ? (PIPELINE_STAGES[idx + 1] ?? null) : null;
}

export function prevStage(stage: PipelineStage): PipelineStage | null {
  const idx = PIPELINE_STAGES.indexOf(stage);
  return idx > 0 ? (PIPELINE_STAGES[idx - 1] ?? null) : null;
}

// ---------------------------------------------------------------------------
// Stage Status
// ---------------------------------------------------------------------------

export type StageStatus =
  | 'pending'
  | 'running'
  | 'awaitingReview'
  | 'accepted'
  | 'rejected'
  | 'skipped'
  | 'failed'
  | 'rolledBack';

// ---------------------------------------------------------------------------
// Pipeline Configuration
// ---------------------------------------------------------------------------

export interface PipelineConfig {
  /** Unique preset identifier (e.g., 'literary-fiction', 'thriller', 'romance') */
  genrePreset: string;
  /** Optional custom style guide override */
  styleGuide?: string;
  /** Which stages to execute (default: all editing + production + publishing) */
  selectedStages: PipelineStage[];
  /** Primary AI provider for this run */
  aiProvider: string;
  /** RAG mode for agentic retrieval */
  ragMode: 'lexical' | 'semantic' | 'hybrid';
  /** Maximum tokens per AI call */
  maxTokens: number;
  /** Creativity temperature */
  creativity: 'Focused' | 'Balanced' | 'Imaginative';
  /** Whether to use DuckDB for vector retrieval */
  useDuckDb: boolean;
  /** Whether to auto-accept low-confidence edits */
  autoAcceptThreshold: number; // 0.0 - 1.0, 0 = never auto-accept
  /** Language for AI responses */
  language: string;
  /** Max supervisor-triggered retries per stage (0 = no retry, 1 = one retry) */
  maxRetries?: 0 | 1;
}

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  genrePreset: 'general-fiction',
  selectedStages: [
    'intake',
    'structural',
    'lineProse',
    'copyEdit',
    'proof',
    'production',
    'publishing',
    'analytics',
  ],
  aiProvider: 'gemini',
  ragMode: 'hybrid',
  maxTokens: 8000,
  creativity: 'Balanced',
  useDuckDb: false,
  autoAcceptThreshold: 0,
  language: 'en',
  maxRetries: 1,
};

// ---------------------------------------------------------------------------
// Review System
// ---------------------------------------------------------------------------

export type ReviewItemType =
  | 'structuralEdit'
  | 'proseEdit'
  | 'grammarEdit'
  | 'styleEdit'
  | 'repetitionHit'
  | 'consistencyIssue'
  | 'plotHole'
  | 'legalWarning'
  | 'technicalIssue'
  | 'pacingIssue'
  | 'arcIssue';

export type ReviewItemSeverity = 'critical' | 'warning' | 'info';

export type ReviewItemStatus = 'pending' | 'accepted' | 'rejected' | 'ignored';

export interface ReviewItem {
  id: string;
  stage: PipelineStage;
  type: ReviewItemType;
  severity: ReviewItemSeverity;
  sectionId?: string;
  sectionTitle?: string;
  /** Character offsets within the section (if applicable) */
  range?: { start: number; end: number };
  /** Human-readable description of the issue/suggestion */
  description: string;
  /** The suggested fix or replacement */
  suggestion?: string;
  /** Original text that would be changed (for diffs) */
  original?: string;
  /** Proposed replacement text */
  proposed?: string;
  /** Rationale for the suggestion */
  rationale?: string;
  /** AI confidence 0.0-1.0 */
  confidence: number;
  status: ReviewItemStatus;
  /** Timestamp when the item was created */
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Stage Results & Metrics
// ---------------------------------------------------------------------------

export interface StageMetrics {
  /** Number of AI calls made */
  aiCalls: number;
  /** Total tokens consumed (input + output, approximate) */
  tokensConsumed: number;
  /** Time elapsed in ms */
  durationMs: number;
  /** Number of edits/issues found */
  itemsFound: number;
  /** Number of items accepted */
  itemsAccepted: number;
  /** Number of items rejected */
  itemsRejected: number;
}

// ---------------------------------------------------------------------------
// Supervisor
// ---------------------------------------------------------------------------

export interface SupervisionDecision {
  pass: boolean;
  retryRecommended: boolean;
  qualityScore: number;
  reasons: string[];
}

export interface StageResult {
  stage: PipelineStage;
  status: StageStatus;
  /** When the stage started */
  startedAt?: string;
  /** When the stage completed or entered review */
  completedAt?: string;
  /** Snapshot ID of the manuscript before this stage */
  preSnapshotId?: string;
  /** Snapshot ID after this stage (if accepted) */
  postSnapshotId?: string;
  /** Review items produced by this stage */
  reviewItems: ReviewItem[];
  /** Stage-specific metrics */
  metrics: StageMetrics;
  /** Raw agent output (for debugging/trace) */
  agentOutput?: unknown;
  /** Error message if stage failed */
  error?: string;
  /** Heuristic quality gate result from SupervisorAgent */
  supervisorDecision?: SupervisionDecision;
}

// ---------------------------------------------------------------------------
// Pipeline Run
// ---------------------------------------------------------------------------

export type PipelineRunStatus =
  | 'idle'
  | 'running'
  | 'awaitingReview'
  | 'completed'
  | 'aborted'
  | 'failed';

export interface PipelineRun {
  id: string;
  projectId: string;
  /** Human-readable label */
  label: string;
  /** Pipeline configuration used */
  config: PipelineConfig;
  /** Overall status */
  status: PipelineRunStatus;
  /** Currently active stage */
  activeStage: PipelineStage;
  /** Results for each executed stage */
  stages: StageResult[];
  /** When the run started */
  startedAt: string;
  /** When the run completed or was aborted */
  completedAt?: string;
  /** Pre-pipeline snapshot ID (for rollback) */
  prePipelineSnapshotId: string;
  /** Trace log of all actions */
  traceLog: TraceLogEntry[];
}

// ---------------------------------------------------------------------------
// Trace / Audit Log
// ---------------------------------------------------------------------------

export type TraceLogAction =
  | 'pipelineStarted'
  | 'stageStarted'
  | 'stageCompleted'
  | 'stageAwaitingReview'
  | 'stageAccepted'
  | 'stageRejected'
  | 'stageSkipped'
  | 'stageFailed'
  | 'stageRolledBack'
  | 'reviewItemAccepted'
  | 'reviewItemRejected'
  | 'reviewItemIgnored'
  | 'snapshotCreated'
  | 'snapshotRestored'
  | 'pipelineAborted'
  | 'pipelineCompleted'
  | 'error';

export interface TraceLogEntry {
  id: string;
  timestamp: string;
  action: TraceLogAction;
  stage?: PipelineStage;
  message: string;
  /** Optional structured data */
  payload?: unknown;
}

// ---------------------------------------------------------------------------
// Pipeline State
// ---------------------------------------------------------------------------

export interface ProForgeState {
  /** Whether ProForge mode is active in the writer view */
  isActive: boolean;
  /** Currently selected view within ProForge: 'dashboard' | 'wizard' | 'review' | 'trace' */
  activeView: 'dashboard' | 'wizard' | 'review' | 'trace' | 'settings';
  /** The current or most recent pipeline run */
  currentRun: PipelineRun | null;
  /** History of completed pipeline runs for this project */
  runHistory: PipelineRun[];
  /** Global configuration defaults */
  defaultConfig: PipelineConfig;
  /** Whether a pipeline is currently running (derived from currentRun.status) */
  isRunning: boolean;
  /** Loading / processing indicator */
  isLoading: boolean;
  /** Current error message */
  error: string | null;
}

// ---------------------------------------------------------------------------
// Diagnostic Phase Outputs
// ---------------------------------------------------------------------------

export interface ManuscriptProfile {
  wordCount: number;
  sectionCount: number;
  averageSectionLength: number;
  detectedGenre?: string;
  pacingEstimate: 'fast' | 'moderate' | 'slow';
  povType?: 'first' | 'third-limited' | 'third-omniscient' | 'second' | 'mixed';
  tense?: 'past' | 'present';
}

export interface ConsistencyIssue {
  id: string;
  type: 'character' | 'timeline' | 'world' | 'plot' | 'object';
  entityName?: string;
  description: string;
  sectionIds: string[];
  severity: ReviewItemSeverity;
}

export interface StructuralGap {
  id: string;
  type: 'missingArc' | 'underdevelopedCharacter' | 'pacingIssue' | 'weakAct' | 'unresolvedThread';
  description: string;
  affectedSectionIds: string[];
  suggestion: string;
}

export interface QualityScore {
  overall: number; // 0-100
  prose: number;
  structure: number;
  consistency: number;
  pacing: number;
  dialogue: number;
  marketability: number;
}

export interface DiagnosticReport {
  profile: ManuscriptProfile;
  consistencyIssues: ConsistencyIssue[];
  structuralGaps: StructuralGap[];
  qualityScore: QualityScore;
  recommendedConfig?: Partial<PipelineConfig>;
  summary: string;
  /** True when AI call failed — scores are zeroed, not real analysis. */
  isFallback?: boolean;
  /** Internal: coherence check note from self-evaluation call. Not shown to author. */
  reflectionNotes?: string;
}

// ---------------------------------------------------------------------------
// Structural Phase Outputs
// ---------------------------------------------------------------------------

export interface StructuralEdit {
  id: string;
  sectionId: string;
  sectionTitle?: string;
  range?: { start: number; end: number };
  category: 'pacing' | 'arc' | 'structure' | 'boundary' | 'reorder';
  original?: string;
  proposed?: string;
  rationale: string;
  confidence: number;
}

export interface PacingReport {
  sectionPacing: Array<{
    sectionId: string;
    sectionTitle: string;
    tensionScore: number; // 0-10
    wordCount: number;
    recommendedAction?: 'expand' | 'compress' | 'keep';
  }>;
  overallPacing: 'fast' | 'moderate' | 'slow' | 'uneven';
  suggestions: string[];
}

export interface StructuralEditPlan {
  edits: StructuralEdit[];
  pacingReport: PacingReport;
  summary: string;
  /** True when AI call failed — edits array is empty, not a clean manuscript. */
  isFallback?: boolean;
  /** Internal: coherence check note from self-evaluation call. Not shown to author. */
  reflectionNotes?: string;
}

// ---------------------------------------------------------------------------
// Prose Phase Outputs
// ---------------------------------------------------------------------------

export type ProseEditCategory =
  | 'showDontTell'
  | 'filterWord'
  | 'dialogue'
  | 'pov'
  | 'sensory'
  | 'weakVerb'
  | 'adverb';

export interface ProseEdit {
  id: string;
  sectionId: string;
  sectionTitle?: string;
  startOffset: number;
  endOffset: number;
  category: ProseEditCategory;
  original: string;
  proposed: string;
  rationale: string;
  confidence: number;
}

export interface ProseMetrics {
  adverbDensity: number; // per 1000 words
  filterWordDensity: number;
  dialogueRatio: number; // % of total words
  sensoryScore: number; // 0-100
  showDontTellScore: number; // 0-100
  povConsistencyScore: number; // 0-100
}

export interface ProseEditBatch {
  edits: ProseEdit[];
  beforeMetrics: ProseMetrics;
  afterMetrics?: ProseMetrics;
  summary: string;
}

// ---------------------------------------------------------------------------
// Copy Edit Phase Outputs
// ---------------------------------------------------------------------------

export interface GrammarEdit {
  id: string;
  sectionId: string;
  startOffset: number;
  endOffset: number;
  ruleId: string;
  ruleName: string;
  original: string;
  proposed: string;
  explanation: string;
}

export interface StyleEdit {
  id: string;
  sectionId: string;
  startOffset: number;
  endOffset: number;
  category: 'register' | 'tone' | 'formality' | 'redundancy';
  original: string;
  proposed: string;
  rationale: string;
}

export interface RepetitionHit {
  id: string;
  wordOrPhrase: string;
  occurrences: Array<{ sectionId: string; startOffset: number; endOffset: number }>;
  count: number;
  suggestion?: string;
}

export interface CopyEditPlan {
  grammarEdits: GrammarEdit[];
  styleEdits: StyleEdit[];
  repetitionHits: RepetitionHit[];
  formatIssues: Array<{
    id: string;
    sectionId: string;
    issue: string;
    suggestion: string;
  }>;
  summary: string;
}

// ---------------------------------------------------------------------------
// Proof Phase Outputs
// ---------------------------------------------------------------------------

export interface LegalWarning {
  id: string;
  type: 'trademark' | 'realPerson' | 'sensitiveContent' | 'copyright' | 'defamation';
  description: string;
  affectedText?: string;
  sectionId?: string;
  severity: 'critical' | 'warning';
  recommendation: string;
}

export interface ReadabilityScore {
  fleschKincaid: number;
  fleschReadingEase: number;
  targetAgeMin: number;
  targetAgeMax: number;
  appropriateForGenre: boolean;
}

export interface QualityGateReport {
  overallPass: boolean;
  grammar: { pass: boolean; score: number; issues: GrammarEdit[] };
  style: { pass: boolean; score: number; issues: StyleEdit[] };
  technical: { pass: boolean; score: number; issues: Array<{ id: string; issue: string }> };
  legal: { pass: boolean; score: number; warnings: LegalWarning[] };
  readability: { pass: boolean; score: number; metrics: ReadabilityScore };
  summary: string;
  /** True when AI call failed — all scores are zeroed, not real analysis. */
  isFallback?: boolean;
}

// ---------------------------------------------------------------------------
// Production Phase Outputs
// ---------------------------------------------------------------------------

export interface ProductionArtifact {
  id: string;
  format: 'pdf' | 'epub' | 'docx' | 'md' | 'txt' | 'norm-txt';
  fileName: string;
  blob?: Blob;
  checksum?: string;
  sizeBytes: number;
  generatedAt: string;
}

export interface ProductionManifest {
  artifacts: ProductionArtifact[];
  compileProfileUsed: boolean;
  typographySettings: Record<string, string>;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Publishing Phase Outputs
// ---------------------------------------------------------------------------

export interface BookMetadata {
  title: string;
  subtitle?: string;
  author: string;
  description: string;
  keywords: string[];
  genre: string;
  bisacCodes: string[];
  language: string;
  pageCount?: number;
  wordCount: number;
}

export interface Blurbs {
  backCover: string;
  amazonDescription: string;
  tagline: string;
  elevatorPitch: string;
  socialMediaPosts: string[];
}

export interface AudiobookGuide {
  chapterMarks: Array<{
    sectionId: string;
    title: string;
    estimatedDurationMinutes: number;
    narratorNotes?: string;
    pronunciationNotes?: Array<{ word: string; phonetic: string }>;
  }>;
  overallNotes: string;
}

export interface MarketingAssets {
  socialMediaPosts: Array<{ platform: string; text: string }>;
  newsletterText: string;
  adCopyVariants: string[];
  authorBioSuggestion: string;
}

export interface PublishingPackage {
  metadata: BookMetadata;
  blurbs: Blurbs;
  audiobookGuide: AudiobookGuide;
  marketingAssets: MarketingAssets;
  rightsPage: string;
}

// ---------------------------------------------------------------------------
// Analytics Phase Outputs
// ---------------------------------------------------------------------------

export interface PipelineMetrics {
  totalDurationMs: number;
  totalAiCalls: number;
  totalTokensConsumed: number;
  stageDurations: Record<string, number>;
  totalEditsFound: number;
  totalEditsAccepted: number;
  totalEditsRejected: number;
  qualityImprovement: number; // overall score delta
}

export interface LessonsLearned {
  whatWorked: string[];
  whatDidntWork: string[];
  recommendations: string[];
  authorNotes: string;
}

export interface PipelineAnalyticsReport {
  runId: string;
  metrics: PipelineMetrics;
  lessonsLearned: LessonsLearned;
  comparisonToPreviousRuns?: Array<{
    runId: string;
    runLabel: string;
    qualityImprovement: number;
    durationMs: number;
  }>;
}

// ---------------------------------------------------------------------------
// Memory Bank
// ---------------------------------------------------------------------------

export interface MemoryBankEntry {
  id: string;
  projectId: string;
  category: 'lore' | 'character' | 'style' | 'feedback' | 'edit' | 'meta';
  key: string;
  content: string;
  sourceStage: PipelineStage;
  createdAt: string;
  embedding?: number[];
}

// ---------------------------------------------------------------------------
// Plugin Extension Points
// ---------------------------------------------------------------------------

export interface PipelineStageExtension {
  id: string;
  name: string;
  description: string;
  insertAfter: PipelineStage;
  agentFactory: () => unknown; // Agent instance factory
  promptTemplateId: string;
  requiredPermissions: string[];
}
