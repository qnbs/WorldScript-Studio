export const RELATED_TEST_LIMIT: number;
export const LOCAL_CHECK_TIMEOUTS_MS: Readonly<{ typecheck: number; relatedTests: number }>;

export interface RelatedTestSelection {
  status: 'NONE' | 'RUN' | 'DEFERRED';
  tests: string[];
  total: number;
}

export function isUnitTestFile(file: string): boolean;
export function relatedTestNeedles(file: string): string[];
export function selectRelatedTests(
  changedFiles: readonly string[],
  options?: {
    search?: (needle: string) => string[];
    exists?: (file: string) => boolean;
    limit?: number;
  },
): RelatedTestSelection;
