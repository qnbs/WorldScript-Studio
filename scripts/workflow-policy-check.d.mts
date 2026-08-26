import type { Document, LineCounter } from 'yaml';

export interface WorkflowPolicyFailure {
  file: string;
  message: string;
}

export interface ListWorkflowFilesDependencies {
  readdirSync?: (dir: string) => string[];
}

export function listWorkflowFiles(
  root?: string,
  dependencies?: ListWorkflowFilesDependencies,
): string[];

export type ListActionFilesDependencies = ListWorkflowFilesDependencies;

export function listActionFiles(
  root?: string,
  dependencies?: ListActionFilesDependencies,
): string[];

export interface ParseWorkflowFileDependencies {
  readFileSync?: (filePath: string, encoding: 'utf8') => string;
}

export interface ParsedWorkflowFile {
  filePath: string;
  content: string;
  doc: Document;
  lineCounter: LineCounter;
}

export function parseWorkflowFile(
  filePath: string,
  dependencies?: ParseWorkflowFileDependencies,
): ParsedWorkflowFile;

export function checkTopLevelPermissions(
  fileName: string,
  doc: Document,
  failures: WorkflowPolicyFailure[],
): void;

export function checkJobWriteScopeAllowlist(
  fileName: string,
  doc: Document,
  failures: WorkflowPolicyFailure[],
): void;

export function checkNeedsGraph(
  fileName: string,
  doc: Document,
  failures: WorkflowPolicyFailure[],
): void;

export interface CheckActionPinsOptions {
  fileKind?: 'workflow' | 'action';
  lineCounter?: LineCounter;
}

export function checkActionPins(
  fileName: string,
  doc: Document,
  failures: WorkflowPolicyFailure[],
  options?: CheckActionPinsOptions,
): void;

export function checkAggregatorNeeds(
  fileName: string,
  doc: Document,
  failures: WorkflowPolicyFailure[],
): void;

export function checkPublishingBoundary(
  fileName: string,
  doc: Document,
  failures: WorkflowPolicyFailure[],
): void;

export interface WorkflowTriggers {
  workflowDispatch: boolean;
  tagPush: boolean;
}

export function getTriggers(doc: Document): WorkflowTriggers;

export type CheckWorkflowFileDependencies = ParseWorkflowFileDependencies;

export function checkWorkflowFile(
  filePath: string,
  dependencies?: CheckWorkflowFileDependencies,
): WorkflowPolicyFailure[];

export function checkActionFile(
  filePath: string,
  dependencies?: CheckWorkflowFileDependencies,
): WorkflowPolicyFailure[];

export type CheckAllWorkflowsDependencies = CheckWorkflowFileDependencies &
  ListWorkflowFilesDependencies & {
    listWorkflowFiles?: (root: string) => string[];
    listActionFiles?: (root: string) => string[];
  };

export function checkAllWorkflows(
  root?: string,
  dependencies?: CheckAllWorkflowsDependencies,
): WorkflowPolicyFailure[];

export function main(): void;
