export const R15_CONTRACT_DOC: string;
export const R15_LEDGER_DOC: string;
export const R15_GATE_IDS: readonly string[];
export const R15_FIXED_STATUSES: readonly string[];
export function parseR15GateEntries(text: string): { gate: string; status: string }[];
export function currentProse(markdown: string): string;
export function scanR15GateStatusTruth(contract: string, ledger: string): string[];
export function isValidR15Status(gate: string, status: string): boolean;
export function stripHtmlComments(text: string): string;
