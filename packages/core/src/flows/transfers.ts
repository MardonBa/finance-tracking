/**
 * Transfer matching (§6, decision 005).
 *
 * Detection order:
 *   1. Plaid's transfer / credit-card-payment categories are the first signal:
 *      pairs where BOTH halves carry them are matched first.
 *   2. Amount matching: an outflow and an equal inflow on two different linked
 *      accounts within MATCH_WINDOW_DAYS. In this second pass at least one half
 *      must carry a transfer label (or have no category at all, e.g. a manual
 *      cash entry); such matches are flagged `needsReview` so a coincidence
 *      (a $50 payment out and an unrelated $50 refund in) lands in Needs a look.
 *   3. Manual links and "mark as transfer" (actions).
 *
 * Matches are computed, not stored, until the user acts: `effectiveTransferLinks`
 * returns the stored active links plus fresh automatic matches. Undoing a match
 * stores the link with `undoneAt` set, which stops that pair from being
 * auto-matched again.
 */
import type { Account, Transaction, TransferLink, TransactionOverride } from "../types.ts";
import { diffDays } from "../dates.ts";
import { isPlaidTransferCategory, isPlaidIncomeCategory } from "./categories.ts";
import { effectiveDate } from "./dates.ts";

// TODO(revisit): "~5 days" from design.md §2; 5 calendar days either way.
export const MATCH_WINDOW_DAYS = 5;

/** Stable id for an automatic match that has not been stored yet. */
export function autoTransferLinkId(outId: string, inId: string): string {
  return `auto:${outId}>${inId}`;
}

export interface TransferMatchInput {
  transactions: readonly Transaction[];
  accounts: readonly Account[];
  transferLinks: readonly TransferLink[];
  overrides: readonly TransactionOverride[];
  /**
   * A bucket fixed by a user rule (rules beat Plaid's labels). Transactions a
   * rule puts in another bucket are never auto-matched.
   */
  ruleBucket?: (t: Transaction) => string | null;
}

function isCandidate(
  t: Transaction,
  overrides: Map<string, TransactionOverride>,
  ruleBucket: TransferMatchInput["ruleBucket"],
): boolean {
  // A manual account's starting balance never pairs with anything.
  if (t.removed || t.pending || t.amountCents === 0 || t.id.endsWith("__opening")) return false;
  const o = overrides.get(t.id);
  // The user said what this is; only an explicit "transfer" stays matchable.
  if (o?.bucket) return o.bucket === "transfer";
  const r = ruleBucket?.(t) ?? null;
  return r === null || r === "transfer";
}

function transferLabelled(t: Transaction): boolean {
  return isPlaidTransferCategory(t.plaidCategoryPrimary, t.plaidCategoryDetailed);
}

/**
 * Automatic matches among transactions not already in an active link.
 * Deterministic: candidates are paired greedily by (pass, date gap, ids).
 */
export function suggestTransferMatches(input: TransferMatchInput): TransferLink[] {
  const accountIds = new Set(input.accounts.map((a) => a.id));
  const overrides = new Map(input.overrides.map((o) => [o.transactionId, o]));
  const used = new Set<string>();
  const blockedPairs = new Set<string>();
  for (const l of input.transferLinks) {
    if (l.undoneAt === null) {
      used.add(l.outTransactionId);
      used.add(l.inTransactionId);
    } else {
      // An undone match means "these two are not a pair"; either half may
      // still match something else.
      blockedPairs.add(`${l.outTransactionId}>${l.inTransactionId}`);
    }
  }
  const pool = input.transactions.filter(
    (t) => accountIds.has(t.accountId) && isCandidate(t, overrides, input.ruleBucket) && !used.has(t.id),
  );
  const outs = pool.filter((t) => t.amountCents < 0);
  const ins = pool.filter((t) => t.amountCents > 0);

  interface Cand {
    out: Transaction;
    in: Transaction;
    pass: 1 | 2;
    gap: number;
  }
  const cands: Cand[] = [];
  for (const o of outs) {
    for (const i of ins) {
      if (o.accountId === i.accountId || -o.amountCents !== i.amountCents) continue;
      if (blockedPairs.has(`${o.id}>${i.id}`)) continue;
      const gap = Math.abs(diffDays(effectiveDate(o), effectiveDate(i)));
      if (gap > MATCH_WINDOW_DAYS) continue;
      const labelled = (t: Transaction) =>
        transferLabelled(t) || overrides.get(t.id)?.bucket === "transfer" || input.ruleBucket?.(t) === "transfer";
      const oLab = labelled(o);
      const iLab = labelled(i);
      let pass: 1 | 2 | null = null;
      if (oLab && iLab) pass = 1;
      else {
        const loose = (t: Transaction) => t.plaidCategoryPrimary === null && t.plaidCategoryDetailed === null;
        const income = (t: Transaction) => isPlaidIncomeCategory(t.plaidCategoryPrimary, t.plaidCategoryDetailed);
        if ((oLab || iLab || loose(o) || loose(i)) && !income(i)) pass = 2;
      }
      // TODO(revisit): amount-only matches need one transfer-labelled (or uncategorised) half.
      if (pass === null) continue;
      cands.push({ out: o, in: i, pass, gap });
    }
  }
  cands.sort(
    (a, b) =>
      a.pass - b.pass ||
      a.gap - b.gap ||
      (a.out.id < b.out.id ? -1 : a.out.id > b.out.id ? 1 : 0) ||
      (a.in.id < b.in.id ? -1 : a.in.id > b.in.id ? 1 : 0),
  );
  const out: TransferLink[] = [];
  for (const c of cands) {
    if (used.has(c.out.id) || used.has(c.in.id)) continue;
    used.add(c.out.id);
    used.add(c.in.id);
    out.push({
      id: autoTransferLinkId(c.out.id, c.in.id),
      outTransactionId: c.out.id,
      inTransactionId: c.in.id,
      source: "auto",
      undoneAt: null,
      needsReview: c.pass === 2,
      createdAt: c.in.createdAt > c.out.createdAt ? c.in.createdAt : c.out.createdAt,
    });
  }
  return out;
}

/** Stored active links (whose transactions still exist) plus automatic matches. */
export function effectiveTransferLinks(input: TransferMatchInput): TransferLink[] {
  const live = new Map(input.transactions.filter((t) => !t.removed).map((t) => [t.id, t]));
  const stored = input.transferLinks.filter(
    (l) => l.undoneAt === null && live.has(l.outTransactionId) && live.has(l.inTransactionId),
  );
  return [...stored, ...suggestTransferMatches(input)];
}
