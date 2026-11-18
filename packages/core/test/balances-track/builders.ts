/** Small row builders for the core-balances tests. */
import type {
  Account,
  BalanceSnapshot,
  Goal,
  Holding,
  InvestmentTransaction,
  RecurringItem,
  Security,
  Transaction,
} from "../../src/types.ts";

export function account(over: Partial<Account> & { id: string }): Account {
  return {
    itemId: "item",
    plaidAccountId: `pa_${over.id}`,
    name: over.id,
    nickname: null,
    mask: null,
    type: "depository",
    subtype: "checking",
    kindOverride: null,
    isManual: false,
    hidden: false,
    protectedAmountCents: 0,
    incomeFallback: false,
    isoCurrencyCode: "USD",
    currentBalanceCents: 0,
    balanceUpdatedAt: null,
    connectedOn: "2026-09-01",
    createdAt: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

let txSeq = 0;
export function tx(accountId: string, date: string, amountCents: number, over: Partial<Transaction> = {}): Transaction {
  txSeq += 1;
  return {
    id: over.id ?? `tx_${accountId}_${date}_${txSeq}`,
    plaidTransactionId: null,
    accountId,
    amountCents,
    isoCurrencyCode: "USD",
    date,
    authorizedDate: null,
    pending: false,
    pendingTransactionId: null,
    rawDescription: "test",
    merchantName: null,
    merchantEntityId: null,
    plaidCategoryPrimary: null,
    plaidCategoryDetailed: null,
    plaidCategoryConfidence: null,
    isManual: false,
    removed: false,
    removedAt: null,
    createdAt: `${date}T00:00:00.000Z`,
    updatedAt: `${date}T00:00:00.000Z`,
    ...over,
  };
}

export function snap(accountId: string, date: string, balanceCents: number, over: Partial<BalanceSnapshot> = {}): BalanceSnapshot {
  return { accountId, date, balanceCents, source: "plaid", isEstimated: false, isCarriedForward: false, ...over };
}

export function goal(over: Partial<Goal> & { id: string; targetCents: number; priority: number }): Goal {
  return {
    name: over.id,
    accountId: "acc_hysa",
    deadline: null,
    expectedContributionCents: null,
    contributionPeriod: null,
    colorSlot: 0,
    completedAt: null,
    archivedAt: null,
    purchaseTransactionId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

export function recurring(over: Partial<RecurringItem> & { id: string }): RecurringItem {
  return {
    plaidStreamId: `stream_${over.id}`,
    source: "auto",
    accountId: "acc_checking",
    direction: "outflow",
    description: over.id,
    merchantName: null,
    category: null,
    frequency: "monthly",
    averageAmountCents: 1000,
    lastAmountCents: 1000,
    lastDate: null,
    predictedNextDate: null,
    isActive: true,
    plaidStatus: "MATURE",
    firstSeenOn: "2026-01-01",
    ...over,
  };
}

export function security(id: string, type: string | null, ticker: string | null = null, name: string | null = id): Security {
  return { id, plaidSecurityId: `p_${id}`, name, tickerSymbol: ticker, type };
}

export function holding(accountId: string, securityId: string, asOfDate: string, valueCents: number, quantity = 1): Holding {
  return { accountId, securityId, asOfDate, quantity, valueCents, isoCurrencyCode: "USD" };
}

export function itx(
  id: string,
  accountId: string,
  date: string,
  type: string,
  subtype: string | null,
  amountCents: number,
  over: Partial<InvestmentTransaction> = {},
): InvestmentTransaction {
  return {
    id,
    plaidInvestmentTransactionId: null,
    accountId,
    securityId: null,
    date,
    type,
    subtype,
    amountCents,
    quantity: null,
    feesCents: null,
    rawDescription: `${type} ${subtype ?? ""}`,
    note: null,
    ...over,
  };
}

/** A tiny deterministic PRNG (tests only) for property-style checks. */
export function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
