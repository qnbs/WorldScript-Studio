// @vitest-environment node
/**
 * Tests for scripts/check-r15-gate-status.mjs (#933).
 * QNBS-v3: contract↔ledger status drift recurred in #917/#928/#929/#930; each case is a shape a reviewer caught or a parser edge found in review.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  currentProse,
  isValidR15Status,
  parseR15GateEntries,
  R15_CONTRACT_DOC,
  R15_LEDGER_DOC,
  scanR15GateStatusTruth,
  stripHtmlComments,
} from '../../scripts/check-r15-gate-status.mjs';

const STATUS: Record<string, string> = {
  '1A': 'IMPLEMENTED_HEADLESS',
  '1B': 'IMPLEMENTED_HEADLESS_AND_PLATFORM_ADAPTER',
  '2': 'IMPLEMENTED_HEADLESS',
  '3': 'SLICE_3A_DURABLE_STAGING',
  '4': 'NOT_ADMITTED',
  '5': 'NOT_ADMITTED',
  '6': 'NOT_ADMITTED',
  '7': 'NOT_ADMITTED',
};

function block(status: Record<string, string> = STATUS, extra = ''): string {
  const lines = Object.entries(status).map(([gate, value]) => `R15_GATE${gate}=${value}`);
  return `\`\`\`text\nR15_GATE_STATUS\n${[...lines, extra].filter(Boolean).join('\n')}\n\`\`\`\n`;
}

function contract(prose = '', status: Record<string, string> = STATUS): string {
  return `# R-15\n\n${prose}\n\n## 20. Plan\n\n${block(status)}`;
}

// Named without the word that secret scanners treat as a credential keyword.
const LEDGER_STATUS_ROW =
  'R15_GATE1A=IMPLEMENTED_HEADLESS / R15_GATE1B=IMPLEMENTED_HEADLESS_AND_PLATFORM_ADAPTER / ' +
  'R15_GATE2=IMPLEMENTED_HEADLESS / R15_GATE3=SLICE_3A_DURABLE_STAGING';

function ledger(prose = 'the rest of Gate 3 and Gates 4–7 not admitted', row = LEDGER_STATUS_ROW) {
  return `| 9 | Other | R15_GATE2=NOT_ADMITTED elsewhere is ignored |\n| 10 | R-15 | ${row}; ${prose} |\n`;
}

const scan = (contractText: string, ledgerText = ledger()) =>
  scanR15GateStatusTruth(contractText, ledgerText);

describe('scanR15GateStatusTruth — canonical block and ledger row 10', () => {
  it('accepts agreeing documents, including the live repository documents', () => {
    expect(scan(contract())).toEqual([]);
    const root = join(__dirname, '..', '..');
    const live = scanR15GateStatusTruth(
      readFileSync(join(root, R15_CONTRACT_DOC), 'utf8'),
      readFileSync(join(root, R15_LEDGER_DOC), 'utf8'),
    );
    expect(live).toEqual([]);
  });

  it('requires exactly one block with every gate', () => {
    expect(scan('# R-15\n')).toEqual([
      `${R15_CONTRACT_DOC} — missing the machine-readable R15_GATE_STATUS block`,
    ]);
    expect(scan(`${contract()}\n${block()}`)).toEqual([
      `${R15_CONTRACT_DOC} — more than one R15_GATE_STATUS block (2 found)`,
    ]);
    const { '5': _omitted, ...withoutGate5 } = STATUS;
    expect(scan(contract('', withoutGate5))).toEqual([
      `${R15_CONTRACT_DOC} — R15_GATE_STATUS has no entry for Gate 5`,
    ]);
  });

  it('rejects duplicate, unknown and unsupported block entries', () => {
    const where = `${R15_CONTRACT_DOC} R15_GATE_STATUS`;
    const text = `# R-15\n\n${block(STATUS, 'R15_GATE2=NOT_ADMITTED\nR15_GATE8=IMPLEMENTED_HEADLESS')}`;
    expect(scan(text)).toEqual(
      expect.arrayContaining([
        `${where} — duplicate entry for R15_GATE2`,
        `${where} — unknown gate R15_GATE8`,
      ]),
    );
    const typo = contract('', { ...STATUS, '4': 'IMPLEMENTED_TYPO' });
    expect(scan(typo)).toContain(`${where} — unsupported status R15_GATE4=IMPLEMENTED_TYPO`);
    // A valid status with a malformed suffix is refused whole, not truncated to its valid prefix.
    const suffixed = contract('', { ...STATUS, '4': 'NOT_ADMITTED-BAD' });
    expect(scan(suffixed)).toContain(`${where} — unsupported status R15_GATE4=NOT_ADMITTED-BAD`);
  });

  it('rejects non-entry lines and trailing text in the block (#935)', () => {
    const where = `${R15_CONTRACT_DOC} R15_GATE_STATUS`;
    const trailing = `# R-15\n\n${block(STATUS).replace('R15_GATE2=IMPLEMENTED_HEADLESS', 'R15_GATE2=IMPLEMENTED_HEADLESS BROKEN')}`;
    expect(scan(trailing)).toEqual([
      `${where} — malformed line "R15_GATE2=IMPLEMENTED_HEADLESS BROKEN"`,
    ]);
    expect(scan(`# R-15\n\n${block(STATUS, 'garbage')}`)).toEqual([
      `${where} — malformed line "garbage"`,
    ]);
  });

  it('ends the block only at a standalone closing fence (#935)', () => {
    const where = `${R15_CONTRACT_DOC} R15_GATE_STATUS`;
    const backticks = `# R-15\n\n${block(STATUS).replace('R15_GATE7=NOT_ADMITTED', 'R15_GATE7=NOT_ADMITTED``` BROKEN')}`;
    expect(scan(backticks)).toContain(
      `${where} — malformed line "R15_GATE7=NOT_ADMITTED\`\`\` BROKEN"`,
    );
    const unclosed = `# R-15\n\n${block(STATUS).replace(/```\n$/, '')}`;
    expect(scan(unclosed)).toEqual([
      `${R15_CONTRACT_DOC} — missing the machine-readable R15_GATE_STATUS block`,
    ]);
  });

  it('reports every problem of an unknown gate (#935)', () => {
    const where = `${R15_CONTRACT_DOC} R15_GATE_STATUS`;
    expect(scan(`# R-15\n\n${block(STATUS, 'R15_GATE8=BOGUS')}`)).toEqual([
      `${where} — unknown gate R15_GATE8`,
      `${where} — unsupported status R15_GATE8=BOGUS`,
    ]);
  });

  it('reports a duplicate entry with an unsupported status as both (#935)', () => {
    const where = `${R15_CONTRACT_DOC} R15_GATE_STATUS`;
    expect(scan(`# R-15\n\n${block(STATUS, 'R15_GATE2=BOGUS')}`)).toEqual(
      expect.arrayContaining([
        `${where} — duplicate entry for R15_GATE2`,
        `${where} — unsupported status R15_GATE2=BOGUS`,
      ]),
    );
  });

  it('binds a slice status to its own gate', () => {
    const where = `${R15_CONTRACT_DOC} R15_GATE_STATUS`;
    const foreign = contract('', { ...STATUS, '3': 'SLICE_2A_DURABLE_STAGING' });
    expect(
      scan(foreign, ledger(undefined, LEDGER_STATUS_ROW.replace('SLICE_3A', 'SLICE_2A'))),
    ).toContain(`${where} — unsupported status R15_GATE3=SLICE_2A_DURABLE_STAGING`);
  });

  it('reads CRLF documents like LF documents', () => {
    const crlf = (text: string) => text.replace(/\n/g, '\r\n');
    expect(scan(crlf(contract())), 'clean').toEqual([]);
    expect(scan(crlf(contract('Gates 3–7\nremain not admitted.')), crlf(ledger()))).toHaveLength(1);
  });

  it('compares only ledger row 10 and rejects its mismatched, duplicate and extra entries', () => {
    const where = `${R15_LEDGER_DOC} row 10`;
    const stale = LEDGER_STATUS_ROW.replace(
      'R15_GATE2=IMPLEMENTED_HEADLESS',
      'R15_GATE2=SLICE_2A_X',
    );
    expect(scan(contract(), ledger(undefined, stale))).toEqual([
      `${where} — R15_GATE2=SLICE_2A_X, but R15_GATE_STATUS says IMPLEMENTED_HEADLESS`,
    ]);
    // A conflicting duplicate is reported in either order.
    for (const row of [
      `R15_GATE2=SLICE_2A_X / ${LEDGER_STATUS_ROW}`,
      `${LEDGER_STATUS_ROW} / R15_GATE2=SLICE_2A_X`,
    ]) {
      expect(scan(contract(), ledger(undefined, row))).toContain(
        `${where} — duplicate entry for R15_GATE2`,
      );
    }
    expect(scan(contract(), `${ledger()}${ledger()}`)).toEqual([
      `${R15_LEDGER_DOC} — more than one row 10 (2 found)`,
    ]);
    const extra = `${LEDGER_STATUS_ROW} / R15_GATE8=IMPLEMENTED_HEADLESS`;
    expect(scan(contract(), ledger(undefined, extra))).toEqual([
      `${where} — unknown gate R15_GATE8`,
    ]);
  });

  it('requires every progressed gate in row 10', () => {
    const withoutGate3 = LEDGER_STATUS_ROW.replace(' / R15_GATE3=SLICE_3A_DURABLE_STAGING', '');
    expect(scan(contract(), ledger(undefined, withoutGate3))).toEqual([
      `${R15_LEDGER_DOC} row 10 — missing R15_GATE3=SLICE_3A_DURABLE_STAGING`,
    ]);
  });
});

describe('scanR15GateStatusTruth — current prose', () => {
  const finding = (ref: string, gate: string) =>
    `${R15_CONTRACT_DOC} — "${ref}" is called not admitted, but R15_GATE_STATUS marks Gate ${gate} as ${STATUS[gate]}`;

  it('catches the reviewer-caught shapes (#917/#929, #930)', () => {
    expect(scan(contract('Gate 1b = implemented; Gates 2–7 = not admitted;'))).toEqual([
      finding('Gates 2–7', '2'),
      finding('Gates 2–7', '3'),
    ]);
    expect(scan(contract('Gates 3–7 not admitted.'))).toEqual([finding('Gates 3–7', '3')]);
  });

  it('keeps references with their status across commas and soft wraps', () => {
    expect(scan(contract('Gates 3–7, not admitted.'))).toEqual([finding('Gates 3–7', '3')]);
    expect(scan(contract('Gates 3–7\nremain not admitted.'))).toEqual([finding('Gates 3–7', '3')]);
    expect(scan(contract('Gate 3, along with Gates 4–7, is not admitted.'))).toEqual([
      finding('Gate 3', '3'),
    ]);
  });

  it('separates sentences and contrastive clauses', () => {
    expect(scan(contract('Gate 2 is implemented. Gates 4–7 are not admitted.'))).toEqual([]);
    const contrast =
      'Gate 2 is implemented headless, while the rest of Gate 3 and Gates 4–7 remain unadmitted.';
    expect(scan(contract(contrast))).toEqual([]);
  });

  it('binds each "not admitted" only to the gates since the previous status predicate', () => {
    expect(scan(contract('Gate 2 is implemented, and Gate 4 is not admitted.'))).toEqual([]);
    expect(scan(contract('Gate 4 is not admitted, and Gate 2 is implemented.'))).toEqual([]);
    expect(scan(contract('Gate 4 is not admitted, and Gate 2 is not admitted.'))).toEqual([
      finding('Gate 2', '2'),
    ]);
  });

  it('checks every gate of a coordinated list (#935)', () => {
    expect(scan(contract('Gates 4 and 3 are not admitted.'))).toEqual([
      finding('Gates 4 and 3', '3'),
    ]);
    expect(scan(contract('Gates 5, 2 or 3A are not admitted.'))).toEqual([
      finding('Gates 5, 2 or 3A', '2'),
      finding('Gates 5, 2 or 3A', '3'),
    ]);
    expect(scan(contract('Gates 4–7 and 3B are not admitted.'))).toEqual([]);
    expect(scan(contract('Gates 4 and 3 slice 3B are not admitted.'))).toEqual([]);
    expect(scan(contract('Gates 4 and 3 slice 3A are not admitted.'))).toEqual([
      finding('Gates 4 and 3 slice 3A', '3'),
    ]);
  });

  it('does not read a longer number as a gate reference', () => {
    expect(scan(contract('Gate 10 is not admitted.'))).toEqual([]);
    expect(scan(contract('Gates 12 and 20 are not admitted.'))).toEqual([]);
  });

  it('resolves Gate 1a/1b and slice references exactly', () => {
    const split = { ...STATUS, '1B': 'NOT_ADMITTED' };
    expect(
      scan(
        contract('Gate 1b is not admitted.', split),
        ledger(
          undefined,
          LEDGER_STATUS_ROW.replace(' / R15_GATE1B=IMPLEMENTED_HEADLESS_AND_PLATFORM_ADAPTER', ''),
        ),
      ),
    ).toEqual([]);
    expect(scan(contract('Gate 1 is not admitted.'))).toHaveLength(2);
    // Slices after the delivered one are legitimately not admitted; the delivered one is not.
    expect(scan(contract('Gate 3B and Gate 3 slice 3C are not admitted.'))).toEqual([]);
    expect(scan(contract('Gate 3 slice 3A is not admitted.'))).toEqual([
      finding('Gate 3 slice 3A', '3'),
    ]);
  });

  it('ignores historical sections, code fences, comments and clauses without gate numbers', () => {
    const ignored = [
      '## HISTORICAL / SUPERSEDED — old\n\nGates 1–7 are not admitted.\n\n## Current',
      '```text\nGates 2–7 not admitted\n```',
      '<!-- Gates 2–7 not admitted -->',
      '<!-- one --> <!-- Gates 2–7 not admitted -->',
      '<!-- unterminated\n\nGates 2–7 not admitted.',
      '~~~text\nGates 2–7 not admitted\n~~~',
      '  ```\nGates 2–7 not admitted\n  ```',
      '````md\n```\nGates 2–7 not admitted\n````',
      '## HISTORICAL — old\n\n### Detail\n\nGates 2–7 not admitted.\n\n## Current',
      'A plaintext fallback is not admitted.',
    ];
    for (const prose of ignored) expect(scan(contract(prose)), prose).toEqual([]);
  });

  it('does not let a literal comment opener inside a fence hide later prose (#935)', () => {
    for (const fence of ['```', '~~~']) {
      const prose = `${fence}html\n<!-- example\n${fence}\n\nGates 3–7 not admitted.`;
      expect(scan(contract(prose)), fence).toEqual([finding('Gates 3–7', '3')]);
    }
    // A fence marker inside a comment does not open a fence.
    const commented = '<!--\n```\n-->\n\nGates 3–7 not admitted.';
    expect(scan(contract(commented))).toEqual([finding('Gates 3–7', '3')]);
    // CommonMark: an HTML block opened by `<!--` ends with the line holding `-->`, rest included,
    // so a marker after the closer opens no fence and the next line is current prose.
    const afterCloser = '<!--\n--> ```\nGates 3–7 not admitted.';
    expect(scan(contract(afterCloser))).toEqual([finding('Gates 3–7', '3')]);
  });

  it('closes a fence only at a marker without trailing content (#935)', () => {
    const prose =
      '```md\nGates 2–7 not admitted\n``` <!-- sample -->\n```\n\nGates 3–7 not admitted.';
    expect(scan(contract(prose))).toEqual([finding('Gates 3–7', '3')]);
  });

  it('keeps the text around a multi-line comment adjacent (#935)', () => {
    expect(scan(contract('Gate 3 is not <!-- why\n-->admitted.'))).toEqual([
      finding('Gate 3', '3'),
    ]);
  });

  it('resumes checking after a historical section, a fence and a comment end', () => {
    const resumed = [
      '## HISTORICAL — old\n\n### Detail\n\nold\n\n## Current\n\nGates 3–7 not admitted.',
      '~~~\nx\n~~~\n\nGates 3–7 not admitted.',
      '<!-- x --> Gates 3–7 not admitted.',
    ];
    for (const prose of resumed)
      expect(scan(contract(prose)), prose).toEqual([finding('Gates 3–7', '3')]);
  });
});

describe('helpers', () => {
  it('parseR15GateEntries keeps every entry, duplicates included', () => {
    expect(parseR15GateEntries('R15_GATE2=A_B / R15_GATE2=C_D')).toEqual([
      { gate: '2', status: 'A_B' },
      { gate: '2', status: 'C_D' },
    ]);
  });

  it('isValidR15Status accepts fixed statuses and slices of the same gate only', () => {
    expect(isValidR15Status('4', 'NOT_ADMITTED')).toBe(true);
    expect(isValidR15Status('3', 'SLICE_3A_DURABLE_STAGING')).toBe(true);
    expect(isValidR15Status('3', 'SLICE_2A_DURABLE_STAGING')).toBe(false);
    expect(isValidR15Status('3', 'SLICE_3A')).toBe(false);
  });

  it('stripHtmlComments removes every comment, including adjacent and unterminated ones', () => {
    expect(stripHtmlComments('a<!-- x -->b<!--y-->c')).toBe('abc');
    expect(stripHtmlComments('a<!--<!-- x -->-->b')).toBe('a-->b');
    expect(stripHtmlComments('a<!-- open')).toBe('a');
  });

  it('currentProse joins soft wraps but keeps list items and table rows apart', () => {
    expect(currentProse('one\ntwo\n\n- item\n| row |')).toBe('one two\n\n- item\n| row |');
  });
});
