const releaseTargetPattern =
  /\b(?:release|releases|artifact|artifacts|latest\.json|uploads\.github\.com|api\.github\.com)\b/i;

const mutatingReleaseCommandPattern =
  /\b(?:gh\s+release\s+(?:create|upload|edit|delete)|gh\s+api\b[^\n]*\b(?:--method|-X)\s*(?:POST|PUT|PATCH|DELETE)\b[^\n]*(?:release|asset)|(?:curl|wget)\b[^\n]*(?:--upload-file|-T\s|--data(?:-binary)?\s|-d\s|-X\s*(?:POST|PUT|PATCH|DELETE))[^\n]*(?:release|asset|uploads\.github\.com|api\.github\.com)|(?:cp|mv|install|scp|aws\s+s3\s+cp|az\s+storage\s+blob\s+upload)\b[^\n]*\b(?:release|releases|artifact|artifacts|latest\.json)\b)/i;

export function isReleasePublishingCommand(line) {
  const uncommented = line
    .replace(/^\s*#.*$/, '')
    .replace(/\s+#.*$/, '')
    .trim();
  if (!uncommented) return false;
  if (mutatingReleaseCommandPattern.test(uncommented)) return true;

  // QNBS-v3: reject shell copies/moves only when their target is release state, not local temp setup.
  return /\b(?:cp|mv|install|scp)\b/i.test(uncommented) && releaseTargetPattern.test(uncommented);
}
