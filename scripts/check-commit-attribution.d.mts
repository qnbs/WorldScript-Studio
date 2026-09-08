export interface AttributionPattern {
  name: string;
  regex: RegExp;
}

export const FORBIDDEN_ATTRIBUTION_PATTERNS: AttributionPattern[];

export interface AttributionCheckResult {
  ok: boolean;
  matches: string[];
}

export function checkAttributionText(text: string | undefined | null): AttributionCheckResult;

export function main(): void;
