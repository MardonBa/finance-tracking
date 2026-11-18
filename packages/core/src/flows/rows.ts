/**
 * Transaction rows (§6 "merchant + category + amount everywhere", §7 rows and
 * drill-down). A row is one transaction; split parts and linked refunds are
 * shown with their parent purchase so a drill-down total is explainable.
 */
import type { Cents } from "../money.ts";
import { Money } from "../money.ts";
import type { IsoDate } from "../dates.ts";
import type { Bucket, Id, Necessity, TransactionId } from "../types.ts";
import type { Contribution, Figure } from "../registry.ts";
import { accountLabel } from "./accounts.ts";
import { categoryLabel } from "./categories.ts";
import type { Ledger, LedgerEntry, NecessitySource } from "./ledger.ts";

export interface RowPart {
  key: string;
  splitId: Id | null;
  category: string;
  categoryLabel: string;
  amountCents: Cents;
}

export interface RowRefund {
  transactionId: TransactionId;
  date: IsoDate;
  amountCents: Cents;
  merchantName: string;
}

export interface TransactionRow {
  transactionId: TransactionId;
  /** Present when the row is a dividend/interest from investmentTransactions. */
  source?: "investment_transaction";
  date: IsoDate;
  postedDate: IsoDate;
  merchantName: string;
  merchantKey: string;
  /** The transaction's category (for a split: the first part's; see `parts`). */
  category: string;
  categoryLabel: string;
  amountCents: Cents;
  accountId: Id;
  accountName: string;
  bucket: Bucket;
  note: string | null;
  rawDescription: string;
  /** "Transfer: Checking → HYSA" for a matched transfer. */
  transferLabel: string | null;
  transferCounterpartId: TransactionId | null;
  refundOfTransactionId: TransactionId | null;
  markers: {
    pending: boolean;
    transfer: boolean;
    split: boolean;
    refund: boolean;
    poker: boolean;
    note: boolean;
  };
  parts: RowPart[];
  /** Refunds linked to this purchase. */
  refunds: RowRefund[];
  /** Hand-applied tag ids (names via `transactions.filterOptions`). */
  tagIds: Id[];
  /** Necessary / not necessary, or null when nothing labels it ("not set"). */
  necessity: Necessity | null;
  /** Where the necessity comes from: this transaction, a rule, its merchant or its category. */
  necessitySource: NecessitySource | null;
}

function accountName(ledger: Ledger, id: Id): string {
  const a = ledger.accounts.get(id);
  return a ? accountLabel(a) : id;
}

function shortAccountName(ledger: Ledger, id: Id): string {
  const a = ledger.accounts.get(id);
  return a ? (a.nickname ?? a.name) : id;
}

/** The refunds linked to each purchase, computed once per ledger. */
const refundIndex = new WeakMap<Ledger, Map<TransactionId, TransactionId[]>>();
function refundsOf(ledger: Ledger, purchaseId: TransactionId): TransactionId[] {
  let idx = refundIndex.get(ledger);
  if (!idx) {
    idx = new Map();
    for (const e of ledger.entries) {
      if (!e.refundOfTransactionId) continue;
      const list = idx.get(e.refundOfTransactionId) ?? [];
      if (!list.includes(e.transactionId)) list.push(e.transactionId);
      idx.set(e.refundOfTransactionId, list);
    }
    refundIndex.set(ledger, idx);
  }
  return idx.get(purchaseId) ?? [];
}

export function transferLabel(ledger: Ledger, e: Pick<LedgerEntry, "transactionId" | "transferCounterpartId">): string | null {
  if (!e.transferCounterpartId) return null;
  const self = ledger.transactions.get(e.transactionId);
  const other = ledger.transactions.get(e.transferCounterpartId);
  if (!self || !other) return null;
  const [out, inn] = self.amountCents < 0 ? [self, other] : [other, self];
  return `Transfer: ${shortAccountName(ledger, out.accountId)} → ${shortAccountName(ledger, inn.accountId)}`;
}

export function rowFor(ledger: Ledger, transactionId: TransactionId): TransactionRow | null {
  const entries = ledger.byTransaction.get(transactionId);
  if (!entries || entries.length === 0) return null;
  const first = entries[0]!;
  const tx = ledger.transactions.get(transactionId);
  const amountCents = tx ? tx.amountCents : Money.sum(entries.map((e) => e.amountCents));
  const isSplit = entries.some((e) => e.splitId !== null);
  const refundOf = first.refundOfTransactionId;
  const row: TransactionRow = {
    transactionId,
    date: first.date,
    postedDate: first.postedDate,
    merchantName: first.merchantName,
    merchantKey: first.merchantKey,
    category: first.category,
    categoryLabel: categoryLabel(first.category),
    amountCents,
    accountId: first.accountId,
    accountName: accountName(ledger, first.accountId),
    bucket: first.bucket,
    note: first.note,
    rawDescription: first.rawDescription,
    transferLabel: transferLabel(ledger, first),
    transferCounterpartId: first.transferCounterpartId,
    refundOfTransactionId: refundOf,
    markers: {
      pending: first.pending,
      transfer: first.bucket === "transfer",
      split: isSplit,
      refund: refundOf !== null,
      poker: first.bucket === "poker",
      note: first.note !== null && first.note.length > 0,
    },
    parts: isSplit
      ? entries.map((e) => ({
          key: e.key,
          splitId: e.splitId,
          category: e.category,
          categoryLabel: categoryLabel(e.category),
          amountCents: e.amountCents,
        }))
      : [],
    refunds: refundsOf(ledger, transactionId).map((id) => {
      const r = ledger.byTransaction.get(id)![0]!;
      return { transactionId: id, date: r.date, amountCents: ledger.transactions.get(id)!.amountCents, merchantName: r.merchantName };
    }),
    tagIds: [...first.tagIds],
    necessity: first.necessity,
    necessitySource: first.necessitySource,
  };
  if (first.source) row.source = first.source;
  // A matched transfer carries one note for the pair: show the other half's if this one has none.
  if (!row.note && first.transferCounterpartId) {
    const other = ledger.byTransaction.get(first.transferCounterpartId)?.[0];
    if (other?.note) {
      row.note = other.note;
      row.markers.note = true;
    }
  }
  return row;
}

/** A drill-down group: a parent row plus the cents each piece contributed. */
export interface DrillGroup {
  row: TransactionRow;
  /** Cents the parent transaction itself (all its parts) contributed. */
  ownCents: Cents;
  /** Split parts of the parent that contributed, by split id. */
  partCents: Record<string, Cents>;
  /** Linked refunds that contributed, by refund transaction id. */
  refundCents: Record<string, Cents>;
  /** ownCents + refunds: the group's share of the figure. */
  totalCents: Cents;
}

export interface DrillDown {
  label: string | null;
  totalCents: Cents;
  count: number;
  groups: DrillGroup[];
}

/**
 * The transactions behind a figure, grouped so split parts and linked refunds
 * appear with their parent purchase. The total always equals the figure.
 */
export function drillDownFigure(ledger: Ledger, fig: Figure): DrillDown {
  const groups = new Map<TransactionId, DrillGroup>();
  const order: TransactionId[] = [];
  const groupFor = (id: TransactionId): DrillGroup => {
    let g = groups.get(id);
    if (!g) {
      const row = rowFor(ledger, id);
      if (!row) throw new Error(`drillDownFigure: unknown transaction ${id}`);
      g = { row, ownCents: 0, partCents: {}, refundCents: {}, totalCents: 0 };
      groups.set(id, g);
      order.push(id);
    }
    return g;
  };
  for (const c of fig.contributions as Contribution[]) {
    const entries = ledger.byTransaction.get(c.transactionId) ?? [];
    const parent = entries.find((e) => e.refundOfTransactionId)?.refundOfTransactionId ?? null;
    if (parent && ledger.byTransaction.has(parent)) {
      const g = groupFor(parent);
      g.refundCents[c.transactionId] = (g.refundCents[c.transactionId] ?? 0) + c.cents;
      g.totalCents += c.cents;
    } else {
      const g = groupFor(c.transactionId);
      g.ownCents += c.cents;
      if (c.splitId) g.partCents[c.splitId] = (g.partCents[c.splitId] ?? 0) + c.cents;
      g.totalCents += c.cents;
    }
  }
  const list = order.map((id) => groups.get(id)!);
  list.sort((a, b) => (a.row.date < b.row.date ? 1 : a.row.date > b.row.date ? -1 : a.row.transactionId < b.row.transactionId ? -1 : 1));
  return {
    label: fig.label ?? null,
    totalCents: Money.sum(list.map((g) => g.totalCents)),
    count: list.length,
    groups: list,
  };
}
