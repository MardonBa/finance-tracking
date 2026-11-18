/**
 * The drill-down filter model (§7) and search. A filter picks ledger entries
 * and a measure turns them into one figure, so "Dining · October · excluding
 * transfers" → a list whose total is exactly the number clicked.
 */
import { z } from "zod";
import type { Cents } from "../money.ts";
import { toCents } from "../money.ts";
import type { IsoDate } from "../dates.ts";
import { isWithin, monthEnd, monthOf, monthStart } from "../dates.ts";
import { BUCKETS } from "../types.ts";
import type { Figure } from "../registry.ts";
import { idSchema, isoDateSchema } from "../schemas.ts";
import { categoryLabel } from "./categories.ts";
import { figure, measures } from "./figures.ts";
import type { Ledger, LedgerEntry } from "./ledger.ts";

export const MEASURES = ["spend", "income", "incomeWithPoker", "saved", "amount", "inflow", "outflow"] as const;
export type MeasureName = (typeof MEASURES)[number];

export const NECESSITY_FILTER = ["necessary", "not_necessary", "not_set"] as const;

export const drillFilterSchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  /** Which date the range applies to: where it counts (default) or the transaction's own date. */
  dateField: z.enum(["countDate", "date"]).optional(),
  buckets: z.array(z.enum(BUCKETS)).optional(),
  /** Detailed or primary categories. */
  categories: z.array(z.string().min(1)).optional(),
  merchantKeys: z.array(z.string().min(1)).optional(),
  accountIds: z.array(idSchema).optional(),
  tagIds: z.array(idSchema).optional(),
  necessity: z.array(z.enum(NECESSITY_FILTER)).optional(),
  includePending: z.boolean().optional(),
  /** Free text: merchant, description, note, or an amount like "12.50". */
  text: z.string().max(200).optional(),
  measure: z.enum(MEASURES).default("amount"),
});
export type DrillFilter = z.input<typeof drillFilterSchema>;

/** A typed amount the user may search for, in cents, or null if it isn't one. */
export function parseAmountQuery(text: string): Cents | null {
  const t = text.trim().replace(/[$,\s]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.abs(toCents(t));
}

export function matchesText(ledger: Ledger, e: LedgerEntry, text: string): boolean {
  const q = text.trim().toLowerCase();
  if (q.length === 0) return true;
  const amount = parseAmountQuery(q);
  if (amount !== null) {
    const tx = ledger.transactions.get(e.transactionId);
    if (Math.abs(e.amountCents) === amount || (tx && Math.abs(tx.amountCents) === amount)) return true;
  }
  return (
    e.merchantName.toLowerCase().includes(q) ||
    e.rawDescription.toLowerCase().includes(q) ||
    (e.note ?? "").toLowerCase().includes(q)
  );
}

export function applyFilter(ledger: Ledger, input: DrillFilter): LedgerEntry[] {
  const f = drillFilterSchema.parse(input);
  const field = f.dateField ?? "countDate";
  return ledger.entries.filter((e) => {
    if (!f.includePending && e.pending) return false;
    const d = e[field];
    if (f.from && d < f.from) return false;
    if (f.to && d > f.to) return false;
    if (f.buckets && !f.buckets.includes(e.bucket)) return false;
    if (f.categories && !f.categories.includes(e.category) && !f.categories.includes(e.categoryPrimary)) return false;
    if (f.merchantKeys && !f.merchantKeys.includes(e.merchantKey)) return false;
    if (f.accountIds && !f.accountIds.includes(e.accountId)) return false;
    if (f.tagIds && !f.tagIds.some((t) => e.tagIds.includes(t))) return false;
    if (f.necessity && !f.necessity.includes(e.necessity ?? "not_set")) return false;
    if (f.text && !matchesText(ledger, e, f.text)) return false;
    return true;
  });
}

/** "Dining · 2026-10 · spending" style label for the filter header. */
export function describeFilter(ledger: Ledger, input: DrillFilter): string {
  const f = drillFilterSchema.parse(input);
  const parts: string[] = [];
  if (f.categories) parts.push(f.categories.map(categoryLabel).join(", "));
  if (f.merchantKeys) parts.push(f.merchantKeys.map((k) => ledger.merchantNames.get(k) ?? k).join(", "));
  if (f.accountIds) {
    parts.push(
      f.accountIds
        .map((id) => {
          const a = ledger.accounts.get(id);
          return a ? (a.nickname ?? a.name) : id;
        })
        .join(", "),
    );
  }
  if (f.from && f.to) parts.push(periodText(f.from, f.to));
  else if (f.from) parts.push(`from ${f.from}`);
  else if (f.to) parts.push(`until ${f.to}`);
  if (f.buckets) {
    const excluded = BUCKETS.filter((b) => !f.buckets!.includes(b));
    if (f.buckets.length === 1) parts.push(f.buckets[0]!);
    if (excluded.includes("transfer")) parts.push("excluding transfers");
  }
  if (f.necessity) parts.push(f.necessity.map((n) => n.replace("_", " ")).join(", "));
  if (f.text) parts.push(`matching "${f.text}"`);
  if (!f.includePending) parts.push("cleared only");
  return parts.join(" · ");
}

function periodText(from: IsoDate, to: IsoDate): string {
  const m = monthOf(from);
  if (from === monthStart(m) && to === monthEnd(m)) return m;
  return `${from} – ${to}`;
}

export function filterFigure(ledger: Ledger, input: DrillFilter): Figure {
  const f = drillFilterSchema.parse(input);
  return figure(applyFilter(ledger, f), measures[f.measure], describeFilter(ledger, f));
}

/** Entries whose countDate is inside the range (convenience for callers). */
export function within(entries: readonly LedgerEntry[], from: IsoDate, to: IsoDate): LedgerEntry[] {
  return entries.filter((e) => isWithin(e.countDate, from, to));
}
