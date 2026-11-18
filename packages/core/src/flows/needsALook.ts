/**
 * "Needs a look" (§6): only what the app is unsure about.
 *  - transfer-labelled transactions with no matching other half
 *  - automatic transfer matches that rest on the amount alone (could be a coincidence)
 *  - uncategorised transactions
 *  - possible duplicates
 *  - large, unusual amounts
 *  - splits that no longer add up (data changed under them)
 * Confirming a transaction (`flows.confirm`) or a rule covering it removes it.
 */
import type { Cents } from "../money.ts";
import type { IsoDate } from "../dates.ts";
import { addDays, diffDays, isWithin } from "../dates.ts";
import type { TransactionId } from "../types.ts";
import { UNCATEGORIZED, categoryLabel } from "./categories.ts";
import { countable, spendCents, type Ledger, type LedgerEntry } from "./ledger.ts";

export const NEEDS_A_LOOK_KINDS = [
  "unmatched_transfer",
  "transfer_match_review",
  "uncategorised",
  "possible_duplicate",
  "large_unusual",
  "split_mismatch",
] as const;
export type NeedsALookKind = (typeof NEEDS_A_LOOK_KINDS)[number];

export interface NeedsALookItem {
  /** Stable id, e.g. "uncategorised:tx_1". */
  id: string;
  kind: NeedsALookKind;
  transactionIds: TransactionId[];
  /** One plain sentence with the numbers behind it. */
  reason: string;
  date: IsoDate;
  merchantName: string;
  category: string;
  amountCents: Cents;
}

export interface NeedsALookOptions {
  from: IsoDate;
  to: IsoDate;
  // TODO(revisit): thresholds for "large unusual" are first guesses.
  /** Spending at or above this with little category history is "large". */
  largeAbsoluteCents?: Cents;
  /** With history: more than this many times the category's average. */
  largeMultiple?: number;
  /** …and at least this much above the average. */
  largeMinAboveAverageCents?: Cents;
  /** Days of category history used for "unusual". */
  historyDays?: number;
  /** Same account, amount and merchant within this many days of the first = possible duplicate (0 = same day). */
  duplicateWindowDays?: number;
}

function whole(ledger: Ledger, id: TransactionId): LedgerEntry[] {
  return ledger.byTransaction.get(id) ?? [];
}

export function needsALook(ledger: Ledger, opts: NeedsALookOptions): NeedsALookItem[] {
  const largeAbs = opts.largeAbsoluteCents ?? 50_000;
  const multiple = opts.largeMultiple ?? 3;
  const minAbove = opts.largeMinAboveAverageCents ?? 10_000;
  const historyDays = opts.historyDays ?? 180;
  const dupDays = opts.duplicateWindowDays ?? 0;
  const items: NeedsALookItem[] = [];
  const inRange = (e: LedgerEntry) => countable(e) && isWithin(e.date, opts.from, opts.to) && !e.source;
  const firsts = new Map<TransactionId, LedgerEntry>();
  for (const e of ledger.entries) if (!firsts.has(e.transactionId) && !e.source) firsts.set(e.transactionId, e);
  const amountOf = (id: TransactionId) => ledger.transactions.get(id)!.amountCents;
  const base = (e: LedgerEntry) => ({
    date: e.date,
    merchantName: e.merchantName,
    category: e.category,
    amountCents: amountOf(e.transactionId),
  });

  for (const e of firsts.values()) {
    if (!inRange(e) || e.confirmed) continue;
    if (e.bucket === "transfer" && e.bucketReason === "plaid_transfer" && e.transferLinkId === null) {
      items.push({
        id: `unmatched_transfer:${e.transactionId}`,
        kind: "unmatched_transfer",
        transactionIds: [e.transactionId],
        reason: "Plaid calls this a transfer, but no matching other half was found in your linked accounts. It is counted as a transfer until you confirm it or mark it as something else.",
        ...base(e),
      });
    }
    if (
      (e.bucket === "spending" || e.bucket === "income") &&
      whole(ledger, e.transactionId).some((x) => x.category === UNCATEGORIZED)
    ) {
      items.push({
        id: `uncategorised:${e.transactionId}`,
        kind: "uncategorised",
        transactionIds: [e.transactionId],
        reason: "No category yet.",
        ...base(e),
      });
    }
  }

  for (const link of ledger.transferLinks) {
    if (!link.needsReview || link.undoneAt !== null) continue;
    const out = firsts.get(link.outTransactionId);
    const inn = firsts.get(link.inTransactionId);
    if (!out || !inn || out.confirmed || inn.confirmed) continue;
    if (!inRange(out) && !inRange(inn)) continue;
    items.push({
      id: `transfer_match_review:${link.id}`,
      kind: "transfer_match_review",
      transactionIds: [link.outTransactionId, link.inTransactionId],
      reason: "Matched as a transfer by amount and date only; undo the match if these are unrelated.",
      ...base(out),
      amountCents: amountOf(out.transactionId),
    });
  }

  // Possible duplicates: same account, amount and merchant, dates within a day.
  const cand = [...firsts.values()].filter((e) => inRange(e) && !e.confirmed && e.bucket !== "transfer");
  const groups = new Map<string, LedgerEntry[]>();
  for (const e of cand) {
    const k = `${e.accountId}|${amountOf(e.transactionId)}|${e.merchantKey}`;
    const list = groups.get(k) ?? [];
    list.push(e);
    groups.set(k, list);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.transactionId < b.transactionId ? -1 : 1));
    let cluster: LedgerEntry[] = [list[0]!];
    const flush = () => {
      if (cluster.length >= 2) {
        const first = cluster[0]!;
        items.push({
          id: `possible_duplicate:${cluster.map((c) => c.transactionId).join("+")}`,
          kind: "possible_duplicate",
          transactionIds: cluster.map((c) => c.transactionId),
          reason:
            dupDays === 0
              ? `${cluster.length} charges of the same amount at ${first.merchantName} on the same day.`
              : `${cluster.length} charges of the same amount at ${first.merchantName} within ${dupDays} day${dupDays === 1 ? "" : "s"}.`,
          ...base(first),
        });
      }
    };
    for (const e of list.slice(1)) {
      // Compared with the cluster's first charge, so daily habits don't chain together.
      if (diffDays(cluster[0]!.date, e.date) <= dupDays) cluster.push(e);
      else {
        flush();
        cluster = [e];
      }
    }
    flush();
  }

  // Large unusual: compared with the same category's recent history.
  const spending = ledger.entries.filter((e) => countable(e) && e.bucket === "spending" && spendCents(e) > 0);
  const byCat = new Map<string, LedgerEntry[]>();
  for (const e of spending) {
    const list = byCat.get(e.categoryPrimary) ?? [];
    list.push(e);
    byCat.set(e.categoryPrimary, list);
  }
  for (const e of spending) {
    if (!inRange(e) || e.confirmed) continue;
    const spend = spendCents(e);
    const histFrom = addDays(e.date, -historyDays);
    const hist = (byCat.get(e.categoryPrimary) ?? []).filter(
      (h) => h.transactionId !== e.transactionId && h.date < e.date && h.date >= histFrom,
    );
    let large = false;
    let why = "";
    if (hist.length >= 3) {
      const avg = Math.round(hist.reduce((s, h) => s + spendCents(h), 0) / hist.length);
      if (spend > avg * multiple && spend - avg >= minAbove) {
        large = true;
        why = `${(spend / avg).toFixed(1)}× your usual ${categoryLabel(e.categoryPrimary)} purchase (average of ${hist.length} in the last ${historyDays} days).`;
      }
    } else if (spend >= largeAbs) {
      // A repeat of a similar charge from the same merchant (rent, tuition) isn't unusual.
      const repeat = spending.some(
        (h) =>
          h.transactionId !== e.transactionId &&
          h.merchantKey === e.merchantKey &&
          h.date < e.date &&
          h.date >= histFrom &&
          Math.abs(spendCents(h) - spend) <= spend * 0.1,
      );
      if (!repeat) {
        large = true;
        why = `A large amount (${categoryLabel(e.categoryPrimary)}) with little history to compare with.`;
      }
    }
    if (large && !items.some((i) => i.kind === "large_unusual" && i.transactionIds[0] === e.transactionId)) {
      items.push({
        id: `large_unusual:${e.transactionId}`,
        kind: "large_unusual",
        transactionIds: [e.transactionId],
        reason: why,
        ...base(e),
      });
    }
  }

  for (const id of ledger.splitMismatches) {
    const e = firsts.get(id);
    if (!e || !inRange(e)) continue;
    items.push({
      id: `split_mismatch:${id}`,
      kind: "split_mismatch",
      transactionIds: [id],
      reason: "The split parts no longer add up to the transaction amount, so it is counted unsplit.",
      ...base(e),
    });
  }

  const order = new Map(NEEDS_A_LOOK_KINDS.map((k, i) => [k, i]));
  return items.sort(
    (a, b) => order.get(a.kind)! - order.get(b.kind)! || (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? -1 : 1),
  );
}
