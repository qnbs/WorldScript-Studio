#!/usr/bin/env node
/**
 * R-15 gate status truth (#933). Gate status is written in three places that drifted in four
 * consecutive PRs (#917, #928, #929, #930): the contract header, the contract's closing status and
 * row 10 of the Core Migration Ledger. The contract's single `R15_GATE_STATUS` block is canonical;
 * this check requires it to be well formed, the ledger's row 10 to agree with it, and no current
 * prose in either document to call a gate (or an already delivered slice) "not admitted".
 *
 * Kept outside the merge-admission evaluator graph (`check-doc-metrics.mjs` is a protected,
 * pinned evaluator file); `pnpm docs:check` and `ci:prepush` run it alongside that checker.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const R15_CONTRACT_DOC = 'docs/native/R15-SECURE-STORAGE-CONTRACT.md';
export const R15_LEDGER_DOC = 'docs/native/CORE-MIGRATION-LEDGER.md';
export const R15_GATE_IDS = Object.freeze(['1A', '1B', '2', '3', '4', '5', '6', '7']);
/** Statuses a gate may have; a partial gate names its last delivered slice (`SLICE_3A_…`). */
export const R15_FIXED_STATUSES = Object.freeze([
  'NOT_ADMITTED',
  'IMPLEMENTED_HEADLESS',
  'IMPLEMENTED_HEADLESS_AND_PLATFORM_ADAPTER',
]);
const SLICE_STATUS = /^SLICE_([2-7])([A-Z])(?:_[A-Z0-9]+)+$/;
// The whole value up to a delimiter is captured, so a malformed suffix is refused, not truncated.
const ENTRY = /\bR15_GATE([0-9A-Za-z]+)=([^\s/|;,`*]+)/g;
const STATUS_BLOCK = /```text\nR15_GATE_STATUS\n([\s\S]*?)```/g;
const LEDGER_ROW = /^\| 10 \|.*$/gm;
const NEGATIVE = /^(?:not admitted|unadmitted)$/i;
// Status predicates; the negative alternatives come first so "not admitted" is not read as "admitted".
const PREDICATE =
  /\bnot admitted\b|\bunadmitted\b|\b(?:implemented|admitted|delivered|landed|terminal)\b/gi;
// "Gate 3", "Gate 1b", "Gate 3B", "Gate 3 slice 3B", "Gates 4–7", optionally after "the rest of".
const GATE_REF =
  /(the (?:rest|remainder) of )?\bGates? ([1-7])([a-z])?(?:\s+slice\s+[1-7]([a-z]))?(?:\s*[–-]\s*([1-7]))?(?![0-9a-z])/gi;
const CLAUSE_BREAK = /;|(?<=[.!?])\s+(?=[A-Z`*(])|,\s+(?:while|whereas|but)\s+/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^(#{1,6})\s/;
const HISTORICAL_HEADING = /\bHISTORICAL\b|\bSUPERSEDED\b/i;

/** Every `R15_GATE<id>=<STATUS>` entry in `text`, in order, duplicates included. */
export function parseR15GateEntries(text) {
  return [...text.matchAll(ENTRY)].map(([, gate, status]) => ({ gate, status }));
}

/** Whether `status` is allowed for `gate`; a slice status must name a slice of that gate. */
export function isValidR15Status(gate, status) {
  if (R15_FIXED_STATUSES.includes(status)) return true;
  return SLICE_STATUS.exec(status)?.[1] === gate;
}

function entryProblem({ gate, status }, seen) {
  if (!R15_GATE_IDS.includes(gate)) return `unknown gate R15_GATE${gate}`;
  if (seen.has(gate)) return `duplicate entry for R15_GATE${gate}`;
  if (!isValidR15Status(gate, status)) return `unsupported status R15_GATE${gate}=${status}`;
  return null;
}

/** Findings for malformed entries: unknown ids, duplicates and unsupported statuses. */
function entryFindings(entries, where) {
  const seen = new Set();
  const findings = [];
  for (const entry of entries) {
    const problem = entryProblem(entry, seen);
    if (problem) findings.push(`${where} — ${problem}`);
    seen.add(entry.gate);
  }
  return findings;
}

function exactlyOne(matches, missing, many) {
  if (matches.length === 1) return { value: matches[0] };
  return { error: matches.length === 0 ? missing : `${many} (${matches.length} found)` };
}

/** The ledger row 10 entries that differ from the canonical status. */
function mismatchFindings(entries, canonical, where) {
  return entries
    .filter(({ gate, status }) => canonical.has(gate) && canonical.get(gate) !== status)
    .map(
      ({ gate, status }) =>
        `${where} — R15_GATE${gate}=${status}, but R15_GATE_STATUS says ${canonical.get(gate)}`,
    );
}

/** Progressed gates (not NOT_ADMITTED) that row 10 does not record. */
function missingFindings(entries, canonical, where) {
  const present = new Set(entries.map(({ gate }) => gate));
  return [...canonical]
    .filter(([gate, status]) => status !== 'NOT_ADMITTED' && !present.has(gate))
    .map(([gate, status]) => `${where} — missing R15_GATE${gate}=${status}`);
}

/** Ledger row 10 against the canonical statuses. */
function ledgerFindings(ledger, canonical) {
  const where = `${R15_LEDGER_DOC} row 10`;
  const row = exactlyOne(
    ledger.match(LEDGER_ROW) ?? [],
    `${R15_LEDGER_DOC} — row 10 (R-15) not found`,
    `${R15_LEDGER_DOC} — more than one row 10`,
  );
  if (row.error) return [row.error];
  const entries = parseR15GateEntries(row.value);
  return [
    ...entryFindings(entries, where),
    ...mismatchFindings(entries, canonical, where),
    ...missingFindings(entries, canonical, where),
  ];
}

/** Removes HTML comments, scanning to each closing marker; an unterminated comment runs to the end. */
export function stripHtmlComments(text) {
  let result = '';
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf('<!--', index);
    if (open === -1) return result + text.slice(index);
    result += text.slice(index, open);
    const close = text.indexOf('-->', open + 4);
    if (close === -1) return result;
    index = close + 3;
  }
  return result;
}

/** Tracks fenced code: returns the new fence marker (or null) after `line`. */
function nextFence(line, fence) {
  const marker = FENCE.exec(line)?.[1];
  if (!marker) return fence;
  if (fence === null) return marker;
  return marker[0] === fence[0] && marker.length >= fence.length ? null : fence;
}

/** Tracks historical sections: returns the heading level that opened one (or null) after `line`. */
function nextHistorical(line, historicalLevel) {
  const level = HEADING.exec(line)?.[1].length;
  if (level === undefined) return historicalLevel;
  if (historicalLevel !== null && level > historicalLevel) return historicalLevel;
  return HISTORICAL_HEADING.test(line) ? level : null;
}

/** Current prose only: comments, code fences and historical sections removed, soft wraps joined. */
export function currentProse(markdown) {
  const kept = [];
  let fence = null;
  let historicalLevel = null;
  for (const line of stripHtmlComments(markdown.replace(/\r\n?/g, '\n')).split('\n')) {
    const wasFenced = fence !== null;
    fence = nextFence(line, fence);
    if (wasFenced || fence !== null) continue;
    historicalLevel = nextHistorical(line, historicalLevel);
    if (historicalLevel === null) kept.push(line);
  }
  // A blank line, heading, list item or table row starts a new unit; anything else continues one.
  return kept.join('\n').replace(/\n(?!\n|#|\s*[-*|]|\s*\d+\.)/g, ' ');
}

/** Gate ids for a bare gate number; Gate 1 is the pair 1a/1b. */
const gateIds = (n) => (n === 1 ? ['1A', '1B'] : [String(n)]);

/** The gate ids (and slice letter, if any) a reference names. */
function referencedGates([, , from, suffix, slice, to]) {
  if (to !== undefined) {
    const numbers = Array.from(
      { length: Math.max(0, Number(to) - Number(from) + 1) },
      (_, i) => Number(from) + i,
    );
    return numbers.flatMap(gateIds).map((gate) => ({ gate }));
  }
  if (from === '1' && suffix) return [{ gate: `1${suffix.toUpperCase()}` }];
  if (from === '1') return gateIds(1).map((gate) => ({ gate }));
  return [{ gate: from, slice: (slice ?? suffix)?.toUpperCase() }];
}

/** Whether calling `target` "not admitted" contradicts `status`. */
function contradicts(status, target, restOf) {
  if (status === undefined || status === 'NOT_ADMITTED') return false;
  const partial = SLICE_STATUS.exec(status);
  if (!partial) return true; // the whole gate is implemented
  if (target.slice) return target.slice <= partial[2]; // a delivered slice called not admitted
  return !restOf; // the whole partial gate called not admitted
}

/** For each "not admitted" phrase, the text since the previous status predicate it governs. */
function negativeSpans(clause) {
  const spans = [];
  let start = 0;
  for (const match of clause.matchAll(PREDICATE)) {
    if (NEGATIVE.test(match[0])) spans.push(clause.slice(start, match.index));
    start = match.index + match[0].length;
  }
  return spans;
}

/** Every gate reference governed by a "not admitted" phrase in `prose`. */
function notAdmittedReferences(prose) {
  return prose
    .split(CLAUSE_BREAK)
    .flatMap((clause) => (clause ? negativeSpans(clause) : []))
    .flatMap((span) => [...span.matchAll(GATE_REF)]);
}

function proseFindings(content, relPath, canonical) {
  return notAdmittedReferences(currentProse(content)).flatMap((ref) =>
    referencedGates(ref)
      .filter((target) => contradicts(canonical.get(target.gate), target, ref[1]))
      .map(
        (target) =>
          `${relPath} — "${ref[0].trim()}" is called not admitted, but R15_GATE_STATUS marks Gate ${target.gate} as ${canonical.get(target.gate)}`,
      ),
  );
}

/** The canonical block's validity findings and gate → status map. */
function canonicalStatus(contract) {
  const block = exactlyOne(
    [...contract.matchAll(STATUS_BLOCK)].map((match) => match[1]),
    `${R15_CONTRACT_DOC} — missing the machine-readable R15_GATE_STATUS block`,
    `${R15_CONTRACT_DOC} — more than one R15_GATE_STATUS block`,
  );
  if (block.error) return { findings: [block.error] };
  const entries = parseR15GateEntries(block.value);
  const canonical = new Map(entries.map(({ gate, status }) => [gate, status]));
  const findings = entryFindings(entries, `${R15_CONTRACT_DOC} R15_GATE_STATUS`).concat(
    R15_GATE_IDS.filter((gate) => !canonical.has(gate)).map(
      (gate) => `${R15_CONTRACT_DOC} — R15_GATE_STATUS has no entry for Gate ${gate}`,
    ),
  );
  return { findings, canonical };
}

/** All R-15 gate status findings for the contract and ledger texts. */
export function scanR15GateStatusTruth(contractText, ledgerText) {
  const contract = contractText.replace(/\r\n?/g, '\n');
  const ledger = ledgerText.replace(/\r\n?/g, '\n');
  const { findings, canonical } = canonicalStatus(contract);
  if (!canonical) return findings;
  return [
    ...findings,
    ...ledgerFindings(ledger, canonical),
    ...proseFindings(contract, R15_CONTRACT_DOC, canonical),
    ...proseFindings(ledger, R15_LEDGER_DOC, canonical),
  ];
}

function main() {
  const root =
    process.env.WORLDSCRIPT_REPOSITORY_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..');
  const findings = scanR15GateStatusTruth(
    readFileSync(join(root, R15_CONTRACT_DOC), 'utf8'),
    readFileSync(join(root, R15_LEDGER_DOC), 'utf8'),
  );
  if (findings.length > 0) {
    process.stderr.write(
      `[r15-gate-status] ${findings.length} finding(s):\n${findings.map((f) => `  - ${f}`).join('\n')}\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    '[r15-gate-status] OK — contract block, ledger row 10 and current prose agree.\n',
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
