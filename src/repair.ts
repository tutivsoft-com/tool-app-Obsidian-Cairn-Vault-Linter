import type { RepairProposal } from "./types";

export interface TextRepairResult {
  after: string;
  applied: RepairProposal[];
  skipped: RepairProposal[];
}

/** Applies exact offset replacements from right to left without guessing. */
export function applyTextRepairs(before: string, proposals: RepairProposal[]): TextRepairResult {
  let after = before;
  const applied: RepairProposal[] = [];
  const skipped: RepairProposal[] = [];
  [...proposals].sort((a, b) => b.start - a.start).forEach((proposal) => {
    if (after.slice(proposal.start, proposal.end) !== proposal.before) {
      skipped.push(proposal);
      return;
    }
    after = `${after.slice(0, proposal.start)}${proposal.after}${after.slice(proposal.end)}`;
    applied.push(proposal);
  });
  return { after, applied, skipped };
}

export function canRollback(current: string, recordedAfter: string): boolean {
  return current === recordedAfter;
}
