export function containsSecretReference(value: unknown, contextKey?: string): boolean;
export function hasExecutableCloudTypecheckCommand(value: unknown): boolean;
export function extractActionReferences(source: string): string[];
export function extractTopLevelJobName(line: string): string | null;
export function isSemanticallyUnconditionalIf(block: string): boolean;
export function isDeploymentTimeConditionalIf(block: string): boolean;
export function hasAggregateResultAssertion(
  block: string | string[],
  dependency: string,
  allowsSkipped: boolean,
): boolean;
export function isReleasePublishingCommand(line: string): boolean;
