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
// A canonical block line is exactly one entry; anything else in the block is malformed data.
const BLOCK_LINE = /^R15_GATE[0-9A-Za-z]+=[^\s/|;,`*]+$/;
// The closing fence must stand on its own line, so backticks inside a malformed entry cannot end
// the block early and an unclosed block is reported as missing.
const STATUS_BLOCK = /^```text\nR15_GATE_STATUS\n([\s\S]*?)^```[ \t]*$/gm;
const LEDGER_ROW = /^\| 10 \|.*$/gm;
const NEGATIVE = /^(?:not admitted|unadmitted)$/i;
// Status predicates; the negative alternatives come first so "not admitted" is not read as "admitted".
const PREDICATE =
  /\bnot admitted\b|\bunadmitted\b|\b(?:implemented|admitted|delivered|landed|terminal)\b/gi;
// "Gate 3", "Gate 1b", "Gate 3B", "Gate 3 slice 3B", "Gates 4–7", "Gates 4 and 3", "Gates 2, 3 or 5",
// optionally after "the rest of". The last group is the coordinated tail after the first item.
const GATE_REF =
  /(the (?:rest|remainder) of )?\bGates? ([1-7])([a-z])?(?:\s+slice\s+[1-7]([a-z]))?(?:\s*[–-]\s*([1-7]))?(?![0-9a-z])((?:(?:\s*,\s*(?:(?:and|or)\s+)?|\s+(?:and|or)\s+)[1-7][a-z]?(?:\s+slice\s+[1-7][a-z])?(?![0-9a-z]))*)/gi;
const LIST_ITEM = /([1-7])([a-z])?(?:\s+slice\s+[1-7]([a-z]))?/gi;
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

/** Every problem with one entry; a duplicate is also checked for an unsupported status. */
function entryProblems({ gate, status }, seen) {
  return [
    !R15_GATE_IDS.includes(gate) && `unknown gate R15_GATE${gate}`,
    seen.has(gate) && `duplicate entry for R15_GATE${gate}`,
    !isValidR15Status(gate, status) && `unsupported status R15_GATE${gate}=${status}`,
  ].filter(Boolean);
}

/** Findings for malformed entries: unknown ids, duplicates and unsupported statuses. */
function entryFindings(entries, where) {
  const seen = new Set();
  const findings = [];
  for (const entry of entries) {
    findings.push(...entryProblems(entry, seen).map((problem) => `${where} — ${problem}`));
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

/**
 * Removes HTML comments from `text`, scanning to each closing marker. `inComment` says whether
 * `text` starts inside a comment; `open` says whether it ends inside one (unterminated).
 */
function stripComments(text, inComment) {
  let result = '';
  let index = 0;
  let open = inComment;
  for (;;) {
    if (open) {
      const close = text.indexOf('-->', index);
      if (close === -1) return { text: result, open: true };
      index = close + 3;
    }
    const start = text.indexOf('<!--', index);
    if (start === -1) return { text: result + text.slice(index), open: false };
    result += text.slice(index, start);
    index = start + 4;
    open = true;
  }
}

/** Removes HTML comments; an unterminated comment runs to the end. */
export function stripHtmlComments(text) {
  return stripComments(text, false).text;
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

/**
 * One source line with fenced code blanked. Fences are recognised only outside comments, so a fence
 * marker inside a comment opens nothing; a fenced line is blanked before comments are removed, so a
 * literal `<!--` in a code example cannot hide the prose after it.
 */
function unfencedLine(line, state) {
  if (!state.comment) {
    const wasFenced = state.fence !== null;
    state.fence = nextFence(line, state.fence);
    if (wasFenced || state.fence !== null) return '';
  }
  state.comment = stripComments(line, state.comment).open;
  return line;
}

/** Lines outside historical sections. */
function currentLines(lines) {
  let historicalLevel = null;
  return lines.filter((line) => {
    historicalLevel = nextHistorical(line, historicalLevel);
    return historicalLevel === null;
  });
}

/** Current prose only: code fences, comments and historical sections removed, soft wraps joined. */
export function currentProse(markdown) {
  const state = { fence: null, comment: false };
  const unfenced = markdown
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => unfencedLine(line, state))
    .join('\n');
  // Comments are removed from the whole text, so the text around a multi-line comment stays adjacent.
  const kept = currentLines(stripHtmlComments(unfenced).split('\n'));
  // A blank line, heading, list item or table row starts a new unit; anything else continues one.
  return kept.join('\n').replace(/\n(?!\n|#|\s*[-*|]|\s*\d+\.)/g, ' ');
}

/** Gate ids for a bare gate number; Gate 1 is the pair 1a/1b. */
const gateIds = (n) => (n === 1 ? ['1A', '1B'] : [String(n)]);

/** The gates of a range such as "Gates 4–7". */
function rangeGates(from, to) {
  const numbers = Array.from(
    { length: Math.max(0, Number(to) - Number(from) + 1) },
    (_, i) => Number(from) + i,
  );
  return numbers.flatMap(gateIds).map((gate) => ({ gate }));
}

/** The gate (and slice letter, if any) of one item such as "3", "3B" or "1b". */
function itemGates(number, letter) {
  if (number === '1' && letter) return [{ gate: `1${letter.toUpperCase()}` }];
  if (number === '1') return gateIds(1).map((gate) => ({ gate }));
  return [{ gate: number, slice: letter?.toUpperCase() }];
}

/** The gate ids (and slice letters) a reference names, coordinated list items included. */
function referencedGates([, , from, suffix, slice, to, tail = '']) {
  const head = to === undefined ? itemGates(from, slice ?? suffix) : rangeGates(from, to);
  return head.concat(
    [...tail.matchAll(LIST_ITEM)].flatMap(([, number, letter, slice]) =>
      itemGates(number, slice ?? letter),
    ),
  );
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

/** Block lines that are not exactly one `R15_GATE<id>=<STATUS>` entry. */
function malformedBlockLines(block) {
  return block
    .split('\n')
    .filter((line) => line.trim() !== '' && !BLOCK_LINE.test(line))
    .map((line) => `${R15_CONTRACT_DOC} R15_GATE_STATUS — malformed line "${line}"`);
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
  // Unknown gates are reported above and kept out of the map, so they cause no follow-on findings.
  const canonical = new Map(
    entries
      .filter(({ gate }) => R15_GATE_IDS.includes(gate))
      .map(({ gate, status }) => [gate, status]),
  );
  const findings = malformedBlockLines(block.value).concat(
    entryFindings(entries, `${R15_CONTRACT_DOC} R15_GATE_STATUS`),
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
