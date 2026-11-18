/**
 * Refund linking (§6, design.md §2). Suggest a purchase for each unlinked
 * refund: same merchant, refund ≤ what is left of the purchase after other
 * linked refunds, purchase on or before the refund and within 90 days.
 * The user confirms with `flows.linkRefund`.
 */
import type { Cents } from "../money.ts";
import { diffDays } from "../dates.ts";
import type { RefundLink, TransactionId } from "../types.ts";
import type { Ledger, LedgerEntry } from "./ledger.ts";

// TODO(revisit): "~90 days" from design.md §2.
export const REFUND_WINDOW_DAYS = 90;

export interface RefundSuggestion {
  refundTransactionId: TransactionId;
  purchaseTransactionId: TransactionId;
  refundCents: Cents;
  purchaseCents: Cents;
  daysApart: number;
  merchantName: string;
}

/** What is left of a purchase (positive cents) after its linked refunds. */
export function refundableCents(ledger: Ledger, purchaseId: TransactionId): Cents {
  const purchase = ledger.transactions.get(purchaseId);
  if (!purchase || purchase.amountCents >= 0) return 0;
  let linked = 0;
  for (const e of ledger.entries) if (e.refundOfTransactionId === purchaseId) linked += e.amountCents;
  return Math.max(0, -purchase.amountCents - linked);
}

/**
 * @param undoneLinks the user's undone refund links; an unlinked pair is never suggested again.
 */
export function suggestRefundLinks(
  ledger: Ledger,
  undoneLinks: readonly Pick<RefundLink, "refundTransactionId" | "purchaseTransactionId" | "undoneAt">[] = [],
): RefundSuggestion[] {
  const blocked = new Set(
    undoneLinks.filter((l) => l.undoneAt !== null).map((l) => `${l.refundTransactionId}>${l.purchaseTransactionId}`),
  );
  const whole = (e: LedgerEntry) => ledger.byTransaction.get(e.transactionId)!;
  const refunds = ledger.entries.filter(
    (e) =>
      !e.pending &&
      !e.source &&
      e.bucket === "spending" &&
      e.bucketReason === "inflow" &&
      e.amountCents > 0 &&
      whole(e).length === 1,
  );
  const purchases = new Map<string, TransactionId[]>();
  for (const t of ledger.transactions.values()) {
    const entries = ledger.byTransaction.get(t.id) ?? [];
    if (t.pending || t.amountCents >= 0 || entries.length === 0 || entries.some((e) => e.bucket !== "spending")) continue;
    const key = entries[0]!.merchantKey;
    const list = purchases.get(key) ?? [];
    list.push(t.id);
    purchases.set(key, list);
  }
  const remaining = new Map<TransactionId, Cents>();
  const out: RefundSuggestion[] = [];
  for (const r of [...refunds].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.key < b.key ? -1 : 1))) {
    let best: { id: TransactionId; gap: number; left: Cents; exact: boolean } | null = null;
    for (const pid of purchases.get(r.merchantKey) ?? []) {
      const p = ledger.transactions.get(pid)!;
      const gap = diffDays(p.authorizedDate ?? p.date, r.date);
      if (gap < 0 || gap > REFUND_WINDOW_DAYS || blocked.has(`${r.transactionId}>${pid}`)) continue;
      const left = remaining.get(pid) ?? refundableCents(ledger, pid);
      if (r.amountCents > left) continue;
      const exact = -p.amountCents === r.amountCents;
      // Prefer an exact amount, then the closest purchase before the refund.
      if (
        best === null ||
        (exact && !best.exact) ||
        (exact === best.exact && (gap < best.gap || (gap === best.gap && pid < best.id)))
      ) {
        best = { id: pid, gap, left, exact };
      }
    }
    if (!best) continue;
    remaining.set(best.id, best.left - r.amountCents);
    out.push({
      refundTransactionId: r.transactionId,
      purchaseTransactionId: best.id,
      refundCents: r.amountCents,
      purchaseCents: -ledger.transactions.get(best.id)!.amountCents,
      daysApart: best.gap,
      merchantName: r.merchantName,
    });
  }
  return out;
}
