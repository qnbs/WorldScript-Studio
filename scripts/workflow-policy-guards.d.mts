export function extractActionReferences(source: string): string[];
export function isSemanticallyUnconditionalIf(block: string): boolean;
export function hasAggregateResultAssertion(
  block: string,
  dependency: string,
  allowsSkipped: boolean,
): boolean;
export function isReleasePublishingCommand(line: string): boolean;
