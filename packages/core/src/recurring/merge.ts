/**
 * The recurring list (§9): Plaid's recurring streams merged with my edits
 * (add / edit / remove). Variable bills are estimated from recent amounts
 * and marked as estimates. Price changes and new charges are noted quietly.
 *
 * Amounts here are positive magnitudes; `direction` says charge or income.
 */
import { Money, type Cents } from "../money.ts";
import { addDays, type IsoDate } from "../dates.ts";
import type {
  AccountId,
  Id,
  RecurringDirection,
  RecurringFrequency,
  RecurringItem,
  RecurringItemTransaction,
  RecurringOverride,
  Transaction,
  TransactionId,
} from "../types.ts";
import { nextOnOrAfter, occurrence } from "./schedule.ts";

/** How many recent amounts a variable bill's estimate uses. */
// TODO(revisit): 3 recent amounts is a default.
export const ESTIMATE_RECENT_COUNT = 3;
/** Amounts varying by more than this share of their average make a bill "variable". */
// TODO(revisit): 5% is a default threshold.
export const VARIABLE_THRESHOLD = 0.05;
/** Charges first seen within this many days are listed quietly as new. */
// TODO(revisit): 30 days is a default.
export const NEW_CHARGE_DAYS = 30;

export interface PriceChange {
  fromCents: Cents;
  toCents: Cents;
  changedOn: IsoDate | null;
  message: string;
}

export interface MergedRecurring {
  id: Id;
  source: "auto" | "manual";
  name: string;
  merchantName: string | null;
  category: string | null;
  accountId: AccountId;
  direction: RecurringDirection;
  frequency: RecurringFrequency;
  /** Positive magnitude. */
  amountCents: Cents;
  isEstimate: boolean;
  /** For estimates: the recent amounts the estimate is the average of. */
  estimateBasis: { amountsCents: Cents[]; transactionIds: TransactionId[] } | null;
  nextDate: IsoDate | null;
  lastDate: IsoDate | null;
  /** Fields I changed by hand. */
  editedFields: Array<"name" | "amount" | "nextDate" | "account" | "frequency">;
  isNew: boolean;
  priceChange: PriceChange | null;
  /** Past occurrences (provenance for drill-down). */
  transactionIds: TransactionId[];
}

export interface MergeResult {
  items: MergedRecurring[];
  /** Items I removed (kept so sync doesn't bring them back). */
  removed: Array<{ id: Id; name: string }>;
  /** Streams Plaid says have stopped. */
  inactive: Array<{ id: Id; name: string }>;
  newCharges: MergedRecurring[];
  priceChanges: MergedRecurring[];
}

export interface MergeInput {
  recurringItems: readonly RecurringItem[];
  recurringOverrides: readonly RecurringOverride[];
  recurringItemTransactions: readonly RecurringItemTransaction[];
  transactions: readonly Transaction[];
  today: IsoDate;
}

function linkedTransactions(input: MergeInput, itemId: Id): Transaction[] {
  const ids = new Set(input.recurringItemTransactions.filter((l) => l.recurringItemId === itemId).map((l) => l.transactionId));
  return input.transactions
    .filter((t) => ids.has(t.id) && !t.pending && !t.removed)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
}

export function isVariable(amounts: readonly Cents[]): boolean {
  if (amounts.length < 2) return false;
  const avg = amounts.reduce((s, a) => s + a, 0) / amounts.length;
  const spread = Math.max(...amounts) - Math.min(...amounts);
  return spread > Math.abs(avg) * VARIABLE_THRESHOLD;
}

export function mergeRecurring(input: MergeInput): MergeResult {
  const items: MergedRecurring[] = [];
  const removed: MergeResult["removed"] = [];
  const inactive: MergeResult["inactive"] = [];
  for (const item of input.recurringItems) {
    const ov = input.recurringOverrides.find((o) => o.recurringItemId === item.id);
    const name = ov?.name ?? item.merchantName ?? item.description;
    if (ov?.removed) {
      removed.push({ id: item.id, name });
      continue;
    }
    if (!item.isActive || item.plaidStatus === "TOMBSTONED") {
      inactive.push({ id: item.id, name });
      continue;
    }
    const txs = linkedTransactions(input, item.id);
    const amounts = txs.map((t) => Math.abs(t.amountCents));
    const recent = amounts.slice(-ESTIMATE_RECENT_COUNT);
    const recentTxs = txs.slice(-ESTIMATE_RECENT_COUNT);
    const variable = isVariable(recent);

    let amountCents: Cents;
    let isEstimate = false;
    let estimateBasis: MergedRecurring["estimateBasis"] = null;
    if (ov?.amountCents != null) amountCents = Math.abs(ov.amountCents);
    else if (variable) {
      amountCents = Math.round(recent.reduce((s, a) => s + a, 0) / recent.length);
      isEstimate = true;
      estimateBasis = { amountsCents: recent, transactionIds: recentTxs.map((t) => t.id) };
    } else if (recent.length) amountCents = recent.at(-1)!;
    else amountCents = Math.abs(item.lastAmountCents ?? item.averageAmountCents);

    let priceChange: PriceChange | null = null;
    if (!variable && item.direction === "outflow" && amounts.length >= 2) {
      const prev = amounts.at(-2)!;
      const last = amounts.at(-1)!;
      if (prev !== last) {
        priceChange = {
          fromCents: prev,
          toCents: last,
          changedOn: txs.at(-1)!.date,
          message: `${name} changed from ${Money.format(prev)} to ${Money.format(last)}.`,
        };
      }
    }

    const frequency = ov?.frequency ?? item.frequency;
    const lastDate = txs.at(-1)?.date ?? item.lastDate;
    const anchor = ov?.nextDate ?? item.predictedNextDate ?? (lastDate ? occurrence(lastDate, frequency, 1) : null);
    const nextDate = anchor ? nextOnOrAfter(anchor, frequency, input.today) : null;

    const editedFields: MergedRecurring["editedFields"] = [];
    if (ov) {
      if (ov.name !== null) editedFields.push("name");
      if (ov.amountCents !== null) editedFields.push("amount");
      if (ov.nextDate !== null) editedFields.push("nextDate");
      if (ov.accountId !== null) editedFields.push("account");
      if (ov.frequency !== null) editedFields.push("frequency");
    }

    items.push({
      id: item.id,
      source: item.source,
      name,
      merchantName: item.merchantName,
      category: item.category,
      accountId: ov?.accountId ?? item.accountId,
      direction: item.direction,
      frequency,
      amountCents,
      isEstimate,
      estimateBasis,
      nextDate,
      lastDate,
      editedFields,
      isNew: item.source === "auto" && (item.plaidStatus === "EARLY_DETECTION" || item.firstSeenOn >= addDays(input.today, -NEW_CHARGE_DAYS)),
      priceChange,
      transactionIds: txs.map((t) => t.id),
    });
  }
  items.sort((a, b) => ((a.nextDate ?? "9999") < (b.nextDate ?? "9999") ? -1 : (a.nextDate ?? "9999") > (b.nextDate ?? "9999") ? 1 : a.name < b.name ? -1 : 1));
  return {
    items,
    removed,
    inactive,
    newCharges: items.filter((i) => i.isNew && i.direction === "outflow"),
    priceChanges: items.filter((i) => i.priceChange !== null),
  };
}
