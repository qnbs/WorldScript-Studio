export const PUBLISH_JOB: string;
export const CHECK_JOB: string;
export const BUNDLE_CHECK: string;
export const DESTINATION_INPUTS: readonly string[];
export const CANONICAL_RUN: Readonly<{ extract: string; bundleCheck: string }>;
export function dockerBuildParity(publishSource: unknown, checkSource: unknown): string[];
