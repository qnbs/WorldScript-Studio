import type { Document } from 'yaml';

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

export interface ParseWorkflowFileDependencies {
  readFileSync?: (filePath: string, encoding: 'utf8') => string;
}

export interface ParsedWorkflowFile {
  filePath: string;
  content: string;
  doc: Document;
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

export function checkActionPins(
  fileName: string,
  content: string,
  failures: WorkflowPolicyFailure[],
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

export type CheckAllWorkflowsDependencies = CheckWorkflowFileDependencies &
  ListWorkflowFilesDependencies & {
    listWorkflowFiles?: (root: string) => string[];
  };

export function checkAllWorkflows(
  root?: string,
  dependencies?: CheckAllWorkflowsDependencies,
): WorkflowPolicyFailure[];

export function main(): void;
