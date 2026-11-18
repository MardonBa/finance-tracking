/**
 * Investments (§17): holdings per account, allocation by type and by
 * holding, performance vs what I put in (from transfers in minus transfers
 * out, not cost basis), the activity list and holdings history.
 */
import { Money, type Cents } from "../money.ts";
import type { IsoDate } from "../dates.ts";
import type { Account, AccountId, Holding, Id, InvestmentTransaction, Security, Transaction, TransactionId, TransferLink } from "../types.ts";
import { accountKind, displayName } from "../balances/accountKinds.ts";

// ---------------------------------------------------------------- holdings

export interface HoldingRow {
  securityId: Id;
  name: string;
  ticker: string | null;
  type: AssetType;
  quantity: number;
  valueCents: Cents;
  /** Share of the account, 0–1. */
  shareOfAccount: number;
}

export interface AccountHoldings {
  accountId: AccountId;
  accountName: string;
  asOfDate: IsoDate | null;
  totalValueCents: Cents;
  holdings: HoldingRow[];
}

export function investmentAccounts(accounts: readonly Account[]): Account[] {
  return accounts.filter((a) => accountKind(a) === "investment" && !a.hidden);
}

export function latestHoldingsDate(holdings: readonly Holding[], accountId: AccountId, onOrBefore?: IsoDate): IsoDate | null {
  let d: IsoDate | null = null;
  for (const h of holdings) if (h.accountId === accountId && (!onOrBefore || h.asOfDate <= onOrBefore) && (d === null || h.asOfDate > d)) d = h.asOfDate;
  return d;
}

export function holdingsByAccount(
  accounts: readonly Account[],
  holdings: readonly Holding[],
  securities: readonly Security[],
  onOrBefore?: IsoDate,
): AccountHoldings[] {
  const sec = new Map(securities.map((s) => [s.id, s]));
  return investmentAccounts(accounts).map((a) => {
    const asOf = latestHoldingsDate(holdings, a.id, onOrBefore);
    const rows = holdings.filter((h) => h.accountId === a.id && h.asOfDate === asOf);
    const total = Money.sum(rows.map((h) => h.valueCents));
    return {
      accountId: a.id,
      accountName: displayName(a),
      asOfDate: asOf,
      totalValueCents: asOf ? total : (a.currentBalanceCents ?? 0),
      holdings: rows
        .map((h) => {
          const s = sec.get(h.securityId);
          return {
            securityId: h.securityId,
            name: s?.name ?? s?.tickerSymbol ?? "Unknown security",
            ticker: s?.tickerSymbol ?? null,
            type: assetType(s?.type ?? null),
            quantity: h.quantity,
            valueCents: h.valueCents,
            shareOfAccount: total > 0 ? h.valueCents / total : 0,
          };
        })
        .sort((x, y) => y.valueCents - x.valueCents || (x.name < y.name ? -1 : 1)),
    };
  });
}

// ---------------------------------------------------------------- allocation

export const ASSET_TYPES = ["stocks", "etfs", "funds", "bonds", "cash", "crypto", "other"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  stocks: "Stocks",
  etfs: "ETFs",
  funds: "Funds",
  bonds: "Bonds",
  cash: "Cash",
  crypto: "Crypto",
  other: "Other",
};

/** Plaid security types → allocation buckets. */
export function assetType(plaidType: string | null): AssetType {
  switch ((plaidType ?? "").toLowerCase()) {
    case "equity":
      return "stocks";
    case "etf":
      return "etfs";
    case "mutual fund":
      return "funds";
    case "fixed income":
      return "bonds";
    case "cash":
      return "cash";
    case "cryptocurrency":
      return "crypto";
    default:
      return "other";
  }
}

export interface AllocationSlice {
  key: string;
  label: string;
  valueCents: Cents;
  share: number;
}

export function allocation(accountHoldings: readonly AccountHoldings[]): { totalCents: Cents; byType: AllocationSlice[]; byHolding: AllocationSlice[] } {
  const all = accountHoldings.flatMap((a) => a.holdings);
  const total = Money.sum(all.map((h) => h.valueCents));
  const share = (v: Cents) => (total > 0 ? v / total : 0);
  const typeMap = new Map<AssetType, Cents>();
  const holdMap = new Map<Id, { label: string; v: Cents }>();
  for (const h of all) {
    typeMap.set(h.type, (typeMap.get(h.type) ?? 0) + h.valueCents);
    const cur = holdMap.get(h.securityId) ?? { label: h.ticker ? `${h.name} (${h.ticker})` : h.name, v: 0 };
    holdMap.set(h.securityId, { ...cur, v: cur.v + h.valueCents });
  }
  return {
    totalCents: total,
    byType: [...typeMap.entries()]
      .map(([k, v]) => ({ key: k, label: ASSET_TYPE_LABELS[k], valueCents: v, share: share(v) }))
      .sort((a, b) => b.valueCents - a.valueCents),
    byHolding: [...holdMap.entries()]
      .map(([k, { label, v }]) => ({ key: k, label, valueCents: v, share: share(v) }))
      .sort((a, b) => b.valueCents - a.valueCents || (a.label < b.label ? -1 : 1)),
  };
}

// ---------------------------------------------------------------- activity

export type ActivityKind = "buy" | "sell" | "dividend" | "interest" | "fee" | "transfer_in" | "transfer_out" | "other";
/** How the activity counts in spending/income (§6): dividends and interest are income; trades and transfers are neither. */
export type CountsAs = "income" | "neither" | "fee";

const DIVIDEND_SUBTYPES = new Set(["dividend", "qualified dividend", "non-qualified dividend", "long-term capital gain", "short-term capital gain", "distribution"]);
const INTEREST_SUBTYPES = new Set(["interest"]);
const TRANSFER_SUBTYPES = new Set(["deposit", "withdrawal", "contribution", "transfer", "send", "request"]);
const FEE_SUBTYPES = new Set(["account fee", "fund fee", "legal fee", "management fee", "miscellaneous fee", "transfer fee", "trust fee", "margin expense"]);

export function classifyActivity(t: Pick<InvestmentTransaction, "type" | "subtype" | "amountCents">): { kind: ActivityKind; countsAs: CountsAs } {
  const type = t.type.toLowerCase();
  const sub = (t.subtype ?? "").toLowerCase();
  if (type === "fee" || FEE_SUBTYPES.has(sub)) return { kind: "fee", countsAs: "fee" };
  if (type === "buy" || sub === "buy" || sub === "buy to cover" || sub === "dividend reinvestment" || sub === "interest reinvestment") return { kind: "buy", countsAs: "neither" };
  if (type === "sell" || sub === "sell" || sub === "sell short") return { kind: "sell", countsAs: "neither" };
  if (DIVIDEND_SUBTYPES.has(sub)) return { kind: "dividend", countsAs: "income" };
  if (INTEREST_SUBTYPES.has(sub)) return { kind: "interest", countsAs: "income" };
  if (type === "transfer" || TRANSFER_SUBTYPES.has(sub)) return { kind: t.amountCents >= 0 ? "transfer_in" : "transfer_out", countsAs: "neither" };
  return { kind: "other", countsAs: "neither" };
}

export interface ActivityRow {
  id: Id;
  accountId: AccountId;
  date: IsoDate;
  kind: ActivityKind;
  countsAs: CountsAs;
  description: string;
  securityName: string | null;
  ticker: string | null;
  quantity: number | null;
  amountCents: Cents;
  feesCents: Cents | null;
  note: string | null;
}

export function activityList(
  investmentTransactions: readonly InvestmentTransaction[],
  securities: readonly Security[],
  filter: { accountId?: AccountId; from?: IsoDate; to?: IsoDate } = {},
): ActivityRow[] {
  const sec = new Map(securities.map((s) => [s.id, s]));
  return investmentTransactions
    .filter((t) => (!filter.accountId || t.accountId === filter.accountId) && (!filter.from || t.date >= filter.from) && (!filter.to || t.date <= filter.to))
    .map((t) => {
      const s = t.securityId ? sec.get(t.securityId) : undefined;
      return {
        id: t.id,
        accountId: t.accountId,
        date: t.date,
        ...classifyActivity(t),
        description: t.rawDescription,
        securityName: s?.name ?? null,
        ticker: s?.tickerSymbol ?? null,
        quantity: t.quantity,
        amountCents: t.amountCents,
        feesCents: t.feesCents,
        note: t.note,
      };
    })
    .sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : a.id < b.id ? -1 : 1));
}

// ---------------------------------------------------------------- performance

export interface ContributionItem {
  date: IsoDate;
  cents: Cents;
  source: "investment" | "transaction";
  id: Id;
}

/**
 * Money moved into (positive) or out of (negative) an investment account:
 * its investment transfer activity plus regular transactions on it that
 * are halves of a transfer link.
 */
export function contributionItems(
  accountId: AccountId,
  investmentTransactions: readonly InvestmentTransaction[],
  transactions: readonly Transaction[],
  transferLinks: readonly TransferLink[],
): ContributionItem[] {
  const linked = new Set(transferLinks.filter((l) => l.undoneAt === null).flatMap((l) => [l.inTransactionId, l.outTransactionId]));
  const fromInv = investmentTransactions
    .filter((t) => t.accountId === accountId && (classifyActivity(t).kind === "transfer_in" || classifyActivity(t).kind === "transfer_out"))
    .map((t) => ({ date: t.date, cents: t.amountCents, source: "investment" as const, id: t.id }));
  const fromTx = transactions
    .filter((t) => t.accountId === accountId && !t.pending && !t.removed && linked.has(t.id))
    .map((t) => ({ date: t.date, cents: t.amountCents, source: "transaction" as const, id: t.id }));
  return [...fromInv, ...fromTx].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export interface Performance {
  accountId: AccountId | "total";
  label: string;
  historyStartsOn: IsoDate | null;
  /** Value when history starts, counted as put in. */
  startingValueCents: Cents;
  netTransfersCents: Cents;
  contributedCents: Cents;
  valueCents: Cents;
  gainCents: Cents;
  /** Gain / contributed; null when nothing was put in. */
  gainPct: number | null;
  transferTransactionIds: TransactionId[];
  investmentTransactionIds: Id[];
  note: string;
}

/**
 * Performance vs what I put in, per account and in total. Contributions =
 * the value when history starts (the connection day) + transfers in −
 * transfers out since. Not Plaid's cost basis.
 * TODO(revisit): the value on the first holdings day counts as put in, since earlier transfers aren't known.
 */
export function performance(input: {
  accounts: readonly Account[];
  holdings: readonly Holding[];
  investmentTransactions: readonly InvestmentTransaction[];
  transactions: readonly Transaction[];
  transferLinks: readonly TransferLink[];
  today: IsoDate;
}): { accounts: Performance[]; total: Performance } {
  const per: Performance[] = investmentAccounts(input.accounts).map((a) => {
    const days = [...new Set(input.holdings.filter((h) => h.accountId === a.id && h.asOfDate >= a.connectedOn).map((h) => h.asOfDate))].sort();
    const start = days[0] ?? null;
    const valueOn = (d: IsoDate) => Money.sum(input.holdings.filter((h) => h.accountId === a.id && h.asOfDate === d).map((h) => h.valueCents));
    const startingValue = start ? valueOn(start) : 0;
    const latest = latestHoldingsDate(input.holdings, a.id, input.today);
    const value = latest ? valueOn(latest) : (a.currentBalanceCents ?? 0);
    const items = contributionItems(a.id, input.investmentTransactions, input.transactions, input.transferLinks).filter((c) => start === null || c.date > start);
    const net = Money.sum(items.map((c) => c.cents));
    const contributed = startingValue + net;
    const gain = value - contributed;
    return {
      accountId: a.id,
      label: displayName(a),
      historyStartsOn: start ?? a.connectedOn,
      startingValueCents: startingValue,
      netTransfersCents: net,
      contributedCents: contributed,
      valueCents: value,
      gainCents: gain,
      gainPct: contributed > 0 ? gain / contributed : null,
      transferTransactionIds: items.filter((i) => i.source === "transaction").map((i) => i.id),
      investmentTransactionIds: items.filter((i) => i.source === "investment").map((i) => i.id),
      note: `Measured from ${start ?? a.connectedOn}, when history starts; the value then counts as what you put in.`,
    };
  });
  const contributed = Money.sum(per.map((p) => p.contributedCents));
  const value = Money.sum(per.map((p) => p.valueCents));
  const starts = per.map((p) => p.historyStartsOn).filter((d): d is IsoDate => d !== null).sort();
  return {
    accounts: per,
    total: {
      accountId: "total",
      label: "All investments",
      historyStartsOn: starts[0] ?? null,
      startingValueCents: Money.sum(per.map((p) => p.startingValueCents)),
      netTransfersCents: Money.sum(per.map((p) => p.netTransfersCents)),
      contributedCents: contributed,
      valueCents: value,
      gainCents: value - contributed,
      gainPct: contributed > 0 ? (value - contributed) / contributed : null,
      transferTransactionIds: per.flatMap((p) => p.transferTransactionIds),
      investmentTransactionIds: per.flatMap((p) => p.investmentTransactionIds),
      note: "Each account is measured from when its history starts.",
    },
  };
}

// ---------------------------------------------------------------- history

export interface HoldingsHistory {
  accountId: AccountId;
  /** Marker for the chart: history starts here (the connection day). */
  historyStartsOn: IsoDate | null;
  points: Array<{ date: IsoDate; valueCents: Cents; holdings: Array<{ securityId: Id; quantity: number; valueCents: Cents }> }>;
}

/** Holdings kept from the day each account was connected. */
export function holdingsHistory(accounts: readonly Account[], holdings: readonly Holding[]): HoldingsHistory[] {
  return investmentAccounts(accounts).map((a) => {
    const own = holdings.filter((h) => h.accountId === a.id && h.asOfDate >= a.connectedOn);
    const days = [...new Set(own.map((h) => h.asOfDate))].sort();
    return {
      accountId: a.id,
      historyStartsOn: days[0] ?? null,
      points: days.map((d) => {
        const rows = own.filter((h) => h.asOfDate === d).sort((x, y) => (x.securityId < y.securityId ? -1 : 1));
        return {
          date: d,
          valueCents: Money.sum(rows.map((h) => h.valueCents)),
          holdings: rows.map((h) => ({ securityId: h.securityId, quantity: h.quantity, valueCents: h.valueCents })),
        };
      }),
    };
  });
}
