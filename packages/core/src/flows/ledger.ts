/**
 * The ledger: every transaction classified once, so every view counts the
 * same way (§6). Each non-removed transaction becomes one or more entries
 * (one per split part, refunds spread over a split purchase's parts), and
 * every entry lands in exactly one bucket: spending, income, transfer or
 * poker. The entries of a transaction always sum to its amount.
 *
 * Bucket, in order (decision 005: per-transaction fix → user rules → Plaid):
 *   1. per-transaction override (`overrides.bucket`)
 *   2. a transfer link (manual, stored automatic, or a fresh automatic match)
 *   3. a linked refund → spending, in the purchase's period and category
 *   4. user rules (by merchant / description, optionally per account)
 *   5. Plaid: transfer / card-payment labels → transfer (unmatched ones go to
 *      Needs a look); anything in an investment account that is not income
 *      (buys, sells, cash moves) → transfer; income categories (wages,
 *      interest, dividends) → income
 *   6. per-account income fallback for plain deposits
 *   7. otherwise spending (outflows are spending, inflows are credits
 *      against spending: unlinked refunds and reimbursements are never income)
 *
 * Category: override → rule → split part → Plaid detailed → Plaid primary →
 * UNCATEGORIZED. Linked refunds take the purchase's category.
 *
 * Necessity (§8, no defaults): transaction (or split part) → rule → merchant
 * label → category label (detailed, then primary) → not set.
 *
 * Pending transactions are in the ledger (they need a bucket for faded
 * display) but every total skips them (`countable`).
 */
import type { Cents } from "../money.ts";
import { Money } from "../money.ts";
import type { IsoDate } from "../dates.ts";
import type {
  Account,
  Bucket,
  CoreData,
  Id,
  Necessity,
  Rule,
  Transaction,
  TransactionId,
  TransferLink,
} from "../types.ts";
import type { Contribution } from "../registry.ts";
import { accountKind } from "./accounts.ts";
import {
  UNCATEGORIZED,
  isCardPaymentCategory,
  isPlaidIncomeCategory,
  isPlaidTransferCategory,
  primaryOf,
} from "./categories.ts";
import { effectiveDate } from "./dates.ts";
import { merchantResolver, type ResolvedMerchant } from "./merchants.ts";
import { effectiveTransferLinks } from "./transfers.ts";

export type BucketReason =
  | "override"
  | "transfer_link"
  | "rule"
  | "refund_link"
  | "plaid_transfer"
  | "investment_account"
  | "plaid_income"
  | "account_fallback"
  | "outflow"
  | "inflow";

export type NecessitySource = "transaction" | "rule" | "merchant" | "category";

export interface LedgerEntry {
  /** Unique per entry: "<txId>", "<txId>#<splitId>", "<txId>@<n>" (refund spread), "<txId>+excess". */
  key: string;
  transactionId: TransactionId;
  /** Set when this entry is a split part of its own transaction. */
  splitId: Id | null;
  accountId: Id;
  /** Signed like Transaction.amountCents: positive = into the account. */
  amountCents: Cents;
  /** The transaction's own date (authorized, else posted). */
  date: IsoDate;
  postedDate: IsoDate;
  /** The date it counts on: `date`, or the purchase's date for a linked refund. */
  countDate: IsoDate;
  pending: boolean;
  bucket: Bucket;
  bucketReason: BucketReason;
  category: string;
  categoryPrimary: string;
  merchantKey: string;
  merchantName: string;
  normalizedMerchantKey: string;
  necessity: Necessity | null;
  necessitySource: NecessitySource | null;
  tagIds: Id[];
  note: string | null;
  rawDescription: string;
  transferLinkId: Id | null;
  transferCounterpartId: TransactionId | null;
  /** For a linked refund: the purchase it belongs to. */
  refundOfTransactionId: TransactionId | null;
  /** Confirmed by the user (dismissed from Needs a look). */
  confirmed: boolean;
  /** Set for dividends/interest read from `investmentTransactions`. */
  source?: "investment_transaction";
}

export type LedgerData = Pick<
  CoreData,
  | "transactions"
  | "accounts"
  | "overrides"
  | "rules"
  | "splits"
  | "transferLinks"
  | "refundLinks"
  | "merchants"
  | "merchantAliases"
  | "necessaryLabels"
  | "transactionTags"
> &
  Partial<Pick<CoreData, "investmentTransactions">>;

/** Data slices every ledger-based query needs. */
export const LEDGER_NEEDS = [
  "transactions",
  "accounts",
  "overrides",
  "rules",
  "splits",
  "transferLinks",
  "refundLinks",
  "merchants",
  "merchantAliases",
  "necessaryLabels",
  "transactionTags",
  "investmentTransactions",
] as const satisfies readonly (keyof CoreData)[];

export interface Ledger {
  entries: LedgerEntry[];
  /** Entries by transaction id (in key order). */
  byTransaction: Map<TransactionId, LedgerEntry[]>;
  transactions: Map<TransactionId, Transaction>;
  accounts: Map<Id, Account>;
  /** Active transfer links, including fresh automatic matches. */
  transferLinks: TransferLink[];
  /** Transactions whose stored splits don't add up (shown in Needs a look). */
  splitMismatches: TransactionId[];
  /** Display name per merchant key (most frequent name, then alphabetical). */
  merchantNames: Map<string, string>;
}

/** Does this entry count toward totals? (cleared only, decision 005) */
export function countable(e: LedgerEntry): boolean {
  return !e.pending;
}

/** Spending as a positive number: purchases add, refunds/credits subtract. 0 outside spending. */
export function spendCents(e: LedgerEntry): Cents {
  return e.bucket === "spending" ? -e.amountCents || 0 : 0;
}

/** Income as a positive number. 0 outside income. */
export function incomeCents(e: LedgerEntry): Cents {
  return e.bucket === "income" ? e.amountCents : 0;
}

export function contribution(e: LedgerEntry, cents: Cents): Contribution {
  if (e.source) return { transactionId: e.transactionId, cents, source: e.source };
  return e.splitId ? { transactionId: e.transactionId, splitId: e.splitId, cents } : { transactionId: e.transactionId, cents };
}

/**
 * Dividends and interest paid inside a brokerage are income (§6, §17).
 * Buys, sells, fees and cash moves in `investmentTransactions` never touch
 * spending or income.
 * TODO(revisit): if an institution also reports the same dividend in
 * /transactions (INCOME_DIVIDENDS on the investment account), it would count
 * twice; Plaid normally keeps investment accounts out of /transactions.
 */
export function isInvestmentIncome(itx: { type: string; subtype: string | null }): boolean {
  if (itx.type === "dividend" || itx.type === "interest") return true;
  const sub = (itx.subtype ?? "").toLowerCase();
  return itx.type === "cash" && (sub.includes("dividend") || sub.includes("interest"));
}

function ruleMatches(rule: Rule, tx: Transaction, merchant: ResolvedMerchant): boolean {
  if (!rule.enabled) return false;
  if (rule.accountId !== null && rule.accountId !== tx.accountId) return false;
  if (rule.matchKind === "merchant") {
    return rule.matchValue === merchant.key || rule.matchValue === merchant.normalizedKey || rule.matchValue === `auto:${merchant.normalizedKey}`;
  }
  const needle = rule.matchValue.trim().toUpperCase();
  return needle.length > 0 && tx.rawDescription.toUpperCase().includes(needle);
}

interface RuleOutcome {
  bucket: Bucket | null;
  category: string | null;
  necessity: Necessity | null;
}

function applyRules(rules: readonly Rule[], tx: Transaction, merchant: ResolvedMerchant): RuleOutcome {
  const out: RuleOutcome = { bucket: null, category: null, necessity: null };
  for (const r of rules) {
    if (!ruleMatches(r, tx, merchant)) continue;
    out.bucket ??= r.setBucket;
    out.category ??= r.setCategory;
    out.necessity ??= r.setNecessity;
  }
  return out;
}

const byKey = (a: { id: string; position?: number }, b: { id: string; position?: number }) =>
  (a.position ?? 0) - (b.position ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function buildLedger(data: LedgerData): Ledger {
  const accounts = new Map(data.accounts.map((a) => [a.id, a]));
  const live = data.transactions.filter((t) => !t.removed);
  const txById = new Map(live.map((t) => [t.id, t]));
  const overrides = new Map(data.overrides.map((o) => [o.transactionId, o]));
  const rules = [...data.rules].sort(byKey);
  const resolver = merchantResolver(data.merchants, data.merchantAliases);
  const merchants = new Map(live.map((t) => [t.id, resolver.resolve(t)]));
  const ruleOut = new Map(live.map((t) => [t.id, applyRules(rules, t, merchants.get(t.id)!)]));

  const links = effectiveTransferLinks({
    transactions: live,
    accounts: data.accounts,
    transferLinks: data.transferLinks,
    overrides: data.overrides,
    ruleBucket: (t) => ruleOut.get(t.id)?.bucket ?? null,
  });
  const linkOf = new Map<TransactionId, { link: TransferLink; counterpart: TransactionId }>();
  // Manual links first so they win if a transaction appears in two stored links.
  for (const l of [...links].sort((a, b) => (a.source === b.source ? 0 : a.source === "manual" ? -1 : 1))) {
    if (linkOf.has(l.outTransactionId) || linkOf.has(l.inTransactionId)) continue;
    linkOf.set(l.outTransactionId, { link: l, counterpart: l.inTransactionId });
    linkOf.set(l.inTransactionId, { link: l, counterpart: l.outTransactionId });
  }

  const tagsByTx = new Map<TransactionId, Id[]>();
  for (const tt of data.transactionTags) {
    const list = tagsByTx.get(tt.transactionId) ?? [];
    list.push(tt.tagId);
    tagsByTx.set(tt.transactionId, list);
  }
  for (const list of tagsByTx.values()) list.sort();

  const splitsByTx = new Map<TransactionId, typeof data.splits>();
  for (const s of data.splits) {
    const list = splitsByTx.get(s.transactionId) ?? [];
    list.push(s);
    splitsByTx.set(s.transactionId, list);
  }
  for (const list of splitsByTx.values()) list.sort(byKey);

  // Active refund links whose both sides exist; one purchase per refund.
  const refundOf = new Map<TransactionId, { purchaseId: TransactionId; linkId: Id }>();
  for (const l of [...data.refundLinks].sort(byKey)) {
    if (l.undoneAt !== null || refundOf.has(l.refundTransactionId)) continue;
    const refund = txById.get(l.refundTransactionId);
    const purchase = txById.get(l.purchaseTransactionId);
    if (!refund || !purchase || refund.amountCents <= 0 || purchase.amountCents >= 0) continue;
    refundOf.set(l.refundTransactionId, { purchaseId: l.purchaseTransactionId, linkId: l.id });
  }

  // ---- bucket per transaction
  interface Base {
    bucket: Bucket;
    reason: BucketReason;
  }
  const baseOf = (t: Transaction): Base => {
    const o = overrides.get(t.id);
    if (o?.bucket) return { bucket: o.bucket, reason: "override" };
    if (linkOf.has(t.id)) return { bucket: "transfer", reason: "transfer_link" };
    if (refundOf.has(t.id)) return { bucket: "spending", reason: "refund_link" };
    const r = ruleOut.get(t.id)!;
    if (r.bucket) return { bucket: r.bucket, reason: "rule" };
    return plaidBase(t);
  };
  const plaidBase = (t: Transaction): Base => {
    const p = t.plaidCategoryPrimary;
    const d = t.plaidCategoryDetailed;
    if (isPlaidTransferCategory(p, d)) return { bucket: "transfer", reason: "plaid_transfer" };
    const acc = accounts.get(t.accountId);
    const income = isPlaidIncomeCategory(p, d);
    if (acc && accountKind(acc) === "investment" && !income) return { bucket: "transfer", reason: "investment_account" };
    if (income) return { bucket: "income", reason: "plaid_income" };
    if (t.amountCents > 0 && acc?.incomeFallback && (p === null || p === "OTHER")) {
      return { bucket: "income", reason: "account_fallback" };
    }
    // TODO(revisit): unlabelled inflows count as credits against spending (never income).
    return t.amountCents < 0 ? { bucket: "spending", reason: "outflow" } : { bucket: "spending", reason: "inflow" };
  };

  const bases = new Map(live.map((t) => [t.id, baseOf(t)]));

  const categoryOfTx = (t: Transaction): string => {
    const o = overrides.get(t.id);
    return o?.category ?? ruleOut.get(t.id)!.category ?? t.plaidCategoryDetailed ?? t.plaidCategoryPrimary ?? UNCATEGORIZED;
  };

  const labels = new Map(data.necessaryLabels.map((l) => [`${l.targetKind}:${l.targetValue}`, l.necessity]));
  const necessityOf = (
    t: Transaction,
    own: Necessity | null,
    category: string,
    merchantKey: string,
  ): { necessity: Necessity | null; source: NecessitySource | null } => {
    if (own) return { necessity: own, source: "transaction" };
    const r = ruleOut.get(t.id)!.necessity;
    if (r) return { necessity: r, source: "rule" };
    const m = labels.get(`merchant:${merchantKey}`);
    if (m) return { necessity: m, source: "merchant" };
    const c = labels.get(`category:${category}`) ?? labels.get(`category:${primaryOf(category)}`);
    if (c) return { necessity: c, source: "category" };
    return { necessity: null, source: null };
  };

  const entries: LedgerEntry[] = [];
  const splitMismatches: TransactionId[] = [];

  // Purchase parts (category, weight) for spreading refunds over splits.
  const partsOf = (t: Transaction): { category: string; amountCents: Cents; necessity: Necessity | null }[] => {
    const splits = splitsByTx.get(t.id);
    const txCat = categoryOfTx(t);
    if (splits && splits.length > 0 && Money.sum(splits.map((s) => s.amountCents)) === t.amountCents) {
      return splits.map((s) => ({ category: s.category ?? txCat, amountCents: s.amountCents, necessity: s.necessity }));
    }
    return [{ category: txCat, amountCents: t.amountCents, necessity: overrides.get(t.id)?.necessity ?? null }];
  };

  // Refund caps: refunds linked to one purchase can't reduce it below zero.
  const refundApplied = new Map<TransactionId, Cents>();
  {
    const groups = new Map<TransactionId, Transaction[]>();
    for (const [refundId, { purchaseId }] of refundOf) {
      if (bases.get(refundId)?.reason !== "refund_link") continue;
      const list = groups.get(purchaseId) ?? [];
      list.push(txById.get(refundId)!);
      groups.set(purchaseId, list);
    }
    for (const [purchaseId, refunds] of groups) {
      let remaining = -txById.get(purchaseId)!.amountCents;
      refunds.sort((a, b) => (effectiveDate(a) < effectiveDate(b) ? -1 : effectiveDate(a) > effectiveDate(b) ? 1 : a.id < b.id ? -1 : 1));
      for (const r of refunds) {
        const applied = Math.min(r.amountCents, Math.max(0, remaining));
        remaining -= applied;
        refundApplied.set(r.id, applied);
      }
    }
  }

  for (const t of [...live].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const base = bases.get(t.id)!;
    const merchant = merchants.get(t.id)!;
    const o = overrides.get(t.id);
    const link = linkOf.get(t.id);
    const date = effectiveDate(t);
    const common = {
      transactionId: t.id,
      accountId: t.accountId,
      date,
      postedDate: t.date,
      pending: t.pending,
      bucket: base.bucket,
      bucketReason: base.reason,
      merchantKey: merchant.key,
      merchantName: merchant.name,
      normalizedMerchantKey: merchant.normalizedKey,
      tagIds: tagsByTx.get(t.id) ?? [],
      note: o?.note ?? null,
      rawDescription: t.rawDescription,
      transferLinkId: link?.link.id ?? null,
      transferCounterpartId: link?.counterpart ?? null,
      confirmed: o?.confirmedAt != null,
    };
    const make = (
      key: string,
      splitId: Id | null,
      amountCents: Cents,
      category: string,
      ownNecessity: Necessity | null,
      countDate: IsoDate,
      refundOfTransactionId: TransactionId | null,
    ): LedgerEntry => {
      const n = necessityOf(t, ownNecessity, category, merchant.key);
      return {
        ...common,
        key,
        splitId,
        amountCents,
        category,
        categoryPrimary: primaryOf(category),
        countDate,
        refundOfTransactionId,
        necessity: n.necessity,
        necessitySource: n.source,
      };
    };

    const refund = base.reason === "refund_link" ? refundOf.get(t.id) : undefined;
    if (refund) {
      const purchase = txById.get(refund.purchaseId)!;
      const applied = refundApplied.get(t.id) ?? 0;
      const excess = t.amountCents - applied;
      const parts = partsOf(purchase);
      const purchaseDate = effectiveDate(purchase);
      if (applied > 0) {
        const shares = Money.allocate(applied, parts.map((p) => Math.abs(p.amountCents)));
        shares.forEach((cents, i) => {
          if (cents === 0 && shares.length > 1) return;
          const p = parts[i]!;
          const key = parts.length > 1 ? `${t.id}@${i}` : t.id;
          entries.push(make(key, null, cents, p.category, o?.necessity ?? p.necessity, purchaseDate, purchase.id));
        });
      }
      if (excess > 0) {
        // The part a purchase can't absorb counts like an unlinked refund.
        entries.push(make(applied > 0 ? `${t.id}+excess` : t.id, null, excess, categoryOfTx(t), o?.necessity ?? null, date, null));
      }
      continue;
    }

    const splits = splitsByTx.get(t.id);
    if (splits && splits.length > 0) {
      if (Money.sum(splits.map((s) => s.amountCents)) === t.amountCents) {
        const txCat = categoryOfTx(t);
        for (const s of splits) {
          entries.push(make(`${t.id}#${s.id}`, s.id, s.amountCents, s.category ?? txCat, s.necessity ?? o?.necessity ?? null, date, null));
        }
        continue;
      }
      splitMismatches.push(t.id);
    }
    entries.push(make(t.id, null, t.amountCents, categoryOfTx(t), o?.necessity ?? null, date, null));
  }

  for (const itx of [...(data.investmentTransactions ?? [])].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!isInvestmentIncome(itx) || itx.amountCents === 0) continue;
    const sub = (itx.subtype ?? itx.type).toLowerCase();
    const category = sub.includes("interest") ? "INCOME_INTEREST_EARNED" : "INCOME_DIVIDENDS";
    const resolved = resolver.resolve({ merchantName: null, rawDescription: itx.rawDescription, merchantEntityId: null });
    entries.push({
      key: `itx:${itx.id}`,
      transactionId: itx.id,
      splitId: null,
      accountId: itx.accountId,
      amountCents: itx.amountCents,
      date: itx.date,
      postedDate: itx.date,
      countDate: itx.date,
      pending: false,
      bucket: "income",
      bucketReason: "plaid_income",
      category,
      categoryPrimary: "INCOME",
      merchantKey: resolved.key,
      merchantName: resolved.name,
      normalizedMerchantKey: resolved.normalizedKey,
      necessity: null,
      necessitySource: null,
      tagIds: [],
      note: itx.note,
      rawDescription: itx.rawDescription,
      transferLinkId: null,
      transferCounterpartId: null,
      refundOfTransactionId: null,
      confirmed: false,
      source: "investment_transaction",
    });
  }

  const byTransaction = new Map<TransactionId, LedgerEntry[]>();
  for (const e of entries) {
    const list = byTransaction.get(e.transactionId) ?? [];
    list.push(e);
    byTransaction.set(e.transactionId, list);
  }

  // One display name per merchant group.
  const nameCounts = new Map<string, Map<string, number>>();
  for (const e of entries) {
    const m = nameCounts.get(e.merchantKey) ?? new Map<string, number>();
    m.set(e.merchantName, (m.get(e.merchantName) ?? 0) + 1);
    nameCounts.set(e.merchantKey, m);
  }
  const merchantNames = new Map<string, string>();
  for (const [key, counts] of nameCounts) {
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]![0];
    merchantNames.set(key, best);
  }
  for (const e of entries) e.merchantName = merchantNames.get(e.merchantKey)!;

  const usedLinks = new Map<Id, TransferLink>();
  for (const { link } of linkOf.values()) usedLinks.set(link.id, link);

  return {
    entries,
    byTransaction,
    transactions: txById,
    accounts,
    transferLinks: [...usedLinks.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
    splitMismatches,
    merchantNames,
  };
}

/** Is this transfer-bucket entry a credit card payment? */
export function isCardPayment(ledger: Ledger, e: LedgerEntry): boolean {
  const t = ledger.transactions.get(e.transactionId);
  return !!t && isCardPaymentCategory(t.plaidCategoryDetailed);
}
