/**
 * LoRA Fine-Tuning Module — Core Types
 * QNBS-v3: Full type system for the personalized writer-style model sprint (v2.0-alpha).
 */

// ---------------------------------------------------------------------------
// Adapter types
// ---------------------------------------------------------------------------

export type LoraAdapterStatus = 'idle' | 'active' | 'merged' | 'archived';
export type LoraFormat = 'safetensors' | 'gguf' | 'merged-gguf';

export interface LoraAdapter {
  id: string;
  name: string;
  description: string;
  modelCompatibility: string;
  scale: number;
  fileSizeBytes: number;
  createdAt: number;
  projectId?: string;
  format?: LoraFormat;
  baseVersionId?: string;
  version?: number;
  isActive?: boolean;
  qualityScore?: number;
  localPath?: string;
  status: LoraAdapterStatus;
}

// ---------------------------------------------------------------------------
// Hyperparameter presets
// ---------------------------------------------------------------------------

export type PresetId =
  | 'writer-style-light'
  | 'deep-narrative'
  | 'dialogue-master'
  | 'full-style-clone';

export type LoraMethod = 'dora' | 'rslora' | 'lora';
export type TargetModules = 'q_v' | 'q_k_v' | 'all_linear';

export interface HyperparamPreset {
  id: PresetId;
  /** i18n key suffix — resolved via t(`lora.presets.${id}.label`) */
  labelKey: string;
  descKey: string;
  rank: 8 | 16 | 32;
  alpha: 16 | 32 | 64;
  epochs: 1 | 2 | 3;
  method: LoraMethod;
  targetModules: TargetModules;
  maxSeqLen: 256 | 512 | 1024 | 2048;
  estimatedMinutes: number;
  requiredVramGb: number;
}

export const HYPERPARAM_PRESETS: HyperparamPreset[] = [
  {
    id: 'writer-style-light',
    labelKey: 'writerStyleLight',
    descKey: 'writerStyleLightDesc',
    rank: 8,
    alpha: 16,
    epochs: 1,
    method: 'dora',
    targetModules: 'q_v',
    maxSeqLen: 512,
    estimatedMinutes: 30,
    requiredVramGb: 8,
  },
  {
    id: 'deep-narrative',
    labelKey: 'deepNarrative',
    descKey: 'deepNarrativeDesc',
    rank: 16,
    alpha: 32,
    epochs: 2,
    method: 'rslora',
    targetModules: 'all_linear',
    maxSeqLen: 1024,
    estimatedMinutes: 60,
    requiredVramGb: 12,
  },
  {
    id: 'dialogue-master',
    labelKey: 'dialogueMaster',
    descKey: 'dialogueMasterDesc',
    rank: 8,
    alpha: 16,
    epochs: 2,
    method: 'dora',
    targetModules: 'q_k_v',
    maxSeqLen: 256,
    estimatedMinutes: 45,
    requiredVramGb: 8,
  },
  {
    id: 'full-style-clone',
    labelKey: 'fullStyleClone',
    descKey: 'fullStyleCloneDesc',
    rank: 32,
    alpha: 64,
    epochs: 3,
    method: 'dora',
    targetModules: 'all_linear',
    maxSeqLen: 2048,
    estimatedMinutes: 90,
    requiredVramGb: 16,
  },
];

// ---------------------------------------------------------------------------
// Dataset
// ---------------------------------------------------------------------------

export type DatasetSource = 'extracted' | 'synthetic';
export type DatasetFormat = 'alpaca' | 'chatml' | 'sharegpt';

export interface DatasetEntry {
  id: string;
  projectId: string;
  instruction: string;
  input: string;
  output: string;
  source: DatasetSource;
  /** 0–1 cosine similarity vs corpus centroid. Entries < 0.4 are filtered. */
  qualityScore: number;
  wordCount: number;
  createdAt: number;
}

export interface DatasetQualityReport {
  totalEntries: number;
  acceptedEntries: number;
  rejectedEntries: number;
  flaggedEntries: number;
  averageQualityScore: number;
  averageWordCount: number;
  sourceBreakdown: { extracted: number; synthetic: number };
  readyToTrain: boolean;
}

// ---------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------

export type TrainingStatus = 'idle' | 'preparing' | 'training' | 'completed' | 'failed' | 'aborted';

export interface TrainingRun {
  id: string;
  projectId: string;
  baseModelId: string;
  presetId: string;
  status: TrainingStatus;
  progressPercent: number;
  currentEpoch: number;
  totalEpochs: number;
  currentLoss: number;
  lossHistory: number[];
  startedAt: number;
  completedAt?: number;
  outputAdapterId?: string;
  errorMessage?: string;
  isFallback?: boolean;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export interface StyleConsistencyReport {
  /** Overall style consistency score (0–1). >0.7 = good match. */
  score: number;
  /** Score for the base model without adapter. */
  baseline: number;
  /** Delta (score - baseline). */
  improvement: number;
  sampleComparisons: Array<{
    prompt: string;
    base: string;
    adapted: string;
    similarity: number;
  }>;
}

// ---------------------------------------------------------------------------
// Redux state
// ---------------------------------------------------------------------------

export type LoraWizardStep = 'model' | 'dataset' | 'params' | 'train' | 'deploy';
export type LoraActiveView = 'library' | 'wizard' | 'evaluation' | 'dataset';

export interface LoraState {
  adapters: LoraAdapter[];
  activeAdapterId: string | null;
  currentRun: TrainingRun | null;
  runHistory: TrainingRun[];
  /** Dataset entries keyed by projectId. */
  datasets: Record<string, DatasetEntry[]>;
  isBuilding: boolean;
  isMerging: boolean;
  isEvaluating: boolean;
  activeView: LoraActiveView;
  wizardStep: LoraWizardStep;
  selectedPresetId: PresetId;
  selectedBaseModel: string;
  error: string | null;
  lastEvaluation: StyleConsistencyReport | null;
}
