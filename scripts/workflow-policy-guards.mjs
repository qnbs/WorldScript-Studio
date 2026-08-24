const releaseTargetPattern =
  /\b(?:release|releases|artifact|artifacts|latest\.json|uploads\.github\.com|api\.github\.com)\b/i;

// QNBS-v3: detect explicit and implicit GitHub release mutations before qualification can pass.
const mutatingReleaseCommandPattern =
  /\b(?:gh\s+release\s+(?:create|upload|edit|delete)|gh\s+api\b(?=[^\n]*(?:(?:--method(?:=|\s+)|-X\s+)(?:POST|PUT|PATCH|DELETE)\b|(?:--raw-field|--field|-F|-f|--input)(?:=|\s+)))(?=[^\n]*(?:\breleases?\b|\bassets?\b))[^\n]*|(?:curl|wget)\b[^\n]*(?:--upload-file|-T\s|--data(?:-binary)?\s|-d\s|--json(?:=|\s+)|-X\s*(?:POST|PUT|PATCH|DELETE)|--request(?:=|\s+)(?:POST|PUT|PATCH|DELETE)\b)[^\n]*(?:release|asset|uploads\.github\.com|api\.github\.com)|(?:cp|mv|install|scp|aws\s+s3\s+cp|az\s+storage\s+blob\s+upload)\b[^\n]*\b(?:release|releases|artifact|artifacts|latest\.json)\b)/i;

function normalizeYamlFoldedRuns(source) {
  const lines = source.split(/\r?\n/);
  const normalized = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    normalized.push(line);
    const foldedRun = line.match(/^(\s*)run:\s*>\s*[+-]?\s*$/);
    if (!foldedRun) continue;
    const baseIndent = foldedRun[1].length;
    const body = [];
    let cursor = index + 1;
    while (cursor < lines.length) {
      const candidate = lines[cursor];
      if (!candidate.trim()) {
        body.push('');
        cursor += 1;
        continue;
      }
      const candidateIndent = candidate.match(/^\s*/)[0].length;
      if (candidateIndent <= baseIndent) break;
      body.push(candidate.trim());
      cursor += 1;
    }
    if (body.length > 0) normalized.push(body.join(' '));
    index = cursor - 1;
  }
  return normalized.join('\n');
}

function normalizeShellContinuations(source) {
  return normalizeYamlFoldedRuns(source).replace(/\\\r?\n[ \t]*/g, ' ');
}

export function isReleasePublishingCommand(source) {
  return normalizeShellContinuations(source)
    .split(/\r?\n/)
    .some((line) => {
      const uncommented = line
        .replace(/^\s*#.*$/, '')
        .replace(/\s+#.*$/, '')
        .trim();
      if (!uncommented) return false;
      if (mutatingReleaseCommandPattern.test(uncommented)) return true;

      // QNBS-v3: reject shell copies/moves only when their target is release state, not local temp setup.
      return (
        /\b(?:cp|mv|install|scp)\b/i.test(uncommented) && releaseTargetPattern.test(uncommented)
      );
    });
}
