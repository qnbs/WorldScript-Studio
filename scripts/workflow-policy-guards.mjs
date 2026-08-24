const releaseTargetPattern =
  /\b(?:release|releases|artifact|artifacts|latest\.json|uploads\.github\.com|api\.github\.com)\b/i;

// QNBS-v3: detect explicit and implicit GitHub release mutations before qualification can pass.
const mutatingReleaseCommandPattern =
  /\b(?:gh\s+release\s+(?:new|create|upload|edit|delete)|gh\s+api\b(?=[^\n]*(?:(?:--method(?:=|\s+)|-X\s+)(?:POST|PUT|PATCH|DELETE)\b|(?:--raw-field|--field|-F|-f|--input)(?:=|\s+)))(?=[^\n]*(?:\breleases?\b|\bassets?\b))[^\n]*|(?:curl|wget)\b[^\n]*(?:--upload-file|-T\s|--data(?:-binary|-raw|-urlencode)?(?:=|\s+)|-d\s|--json(?:=|\s+)|--post-(?:data|file)(?:=|\s+)|--method(?:=|\s+)(?:POST|PUT|PATCH|DELETE)\b|-X\s*(?:POST|PUT|PATCH|DELETE)|--request(?:=|\s+)(?:POST|PUT|PATCH|DELETE)\b)[^\n]*(?:release|asset|uploads\.github\.com|api\.github\.com)|(?:cp|mv|install|scp|aws\s+s3\s+cp|az\s+storage\s+blob\s+upload)\b[^\n]*\b(?:release|releases|artifact|artifacts|latest\.json)\b)/i;

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

export function extractActionReferences(source) {
  return [...source.matchAll(/\b["']?uses["']?\s*:\s*([^\s,}]+)/g)].map(([, rawReference]) =>
    rawReference.replace(/^(['"])(.*)\1$/, '$2'),
  );
}

export function extractTopLevelJobName(line) {
  const match = line.match(/^ {2}(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+)):\s*$/);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

export function isSemanticallyUnconditionalIf(block) {
  const match = block.match(/^\s*if:\s*(.+)$/m);
  const rawExpression = match?.[1] ?? (block.trim() ? block : null);
  if (!rawExpression) return false;
  const expression = rawExpression
    .replace(/\s+#.*$/, '')
    .trim()
    .replace(/^\$\{\{\s*/, '')
    .replace(/\s*\}\}$/, '')
    .trim();
  return /^(?:always\(\)|true)$/i.test(expression);
}

export function hasAggregateResultAssertion(block, dependency, allowsSkipped) {
  // QNBS-v3: require the result comparison to route failure into FAIL=1, not merely mention a token.
  const source = Array.isArray(block) ? block.join('\n') : block;
  const lines = source
    .split('\n')
    .map((line) => line.replace(/^\s*#.*$/, '').replace(/\s+#.*$/, ''));
  const token = `needs.${dependency}.result`;
  return lines.some((line, index) => {
    if (!line.includes(token)) return false;
    const context = lines.slice(index, index + 5).join('\n');
    if (!/FAIL\s*=\s*1/.test(context)) return false;
    if (allowsSkipped) {
      return (
        /!=\s*['"]success['"]/.test(line) &&
        /!=\s*['"]skipped['"]/.test(line) &&
        /\bthen\b/.test(context)
      );
    }
    return /\s=\s*['"]success['"]/.test(line) && /\|\|[^\n]*FAIL\s*=\s*1/.test(context);
  });
}

export function isReleasePublishingCommand(source) {
  const normalizedSource = Array.isArray(source) ? source.join('\n') : source;
  return normalizeShellContinuations(normalizedSource)
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
