/**
 * Hand-built fixture for the transaction rules, spending, drill-down and
 * budget tests (core-flows). Four months of a typical life, "today" is
 * 2026-10-20. Every id names the case it covers. Amounts are integer cents,
 * positive = into the account.
 *
 * Covered: paychecks, HYSA interest, brokerage dividend (investment
 * transactions), rent, groceries, rising dining, small frequent coffee,
 * automatically matched HYSA and brokerage transfers, card payments, a buy
 * inside the brokerage, a refund in a later month (linked) and an unlinked
 * refund, a split, Poker in/out through payer rules (net loss), an unmatched
 * Zelle transfer, ATM → cash, an uncategorised cash purchase, a trip across
 * two months, a pending charge, a possible duplicate, a large unusual
 * purchase, necessity labels, cutting back, a recurring charge, one monthly
 * budget with three parts, and balance snapshots with an unexplained
 * difference.
 */
import type { IsoDate } from "../src/dates.ts";
import {
  emptyData,
  type Account,
  type AccountKind,
  type AccountType,
  type BalanceSnapshot,
  type CoreData,
  type Transaction,
} from "../src/types.ts";

export interface FlowsFixture {
  today: IsoDate;
  data: CoreData;
}

const T0 = "2026-07-01T00:00:00.000Z";

export function account(id: string, type: AccountType, subtype: string | null, extra: Partial<Account> = {}): Account {
  return {
    id,
    itemId: extra.isManual ? null : "item_bank",
    plaidAccountId: extra.isManual ? null : `pa_${id}`,
    name: id,
    nickname: null,
    mask: null,
    type,
    subtype,
    kindOverride: null as AccountKind | null,
    isManual: false,
    hidden: false,
    protectedAmountCents: 0,
    incomeFallback: false,
    isoCurrencyCode: "USD",
    currentBalanceCents: null,
    balanceUpdatedAt: null,
    connectedOn: "2026-07-01",
    createdAt: T0,
    ...extra,
  };
}

export interface TxOpts {
  authorizedDate?: IsoDate | null;
  pending?: boolean;
  merchantName?: string | null;
  raw?: string;
  primary?: string | null;
  detailed?: string | null;
  removed?: boolean;
  merchantEntityId?: string | null;
}

export function txn(id: string, accountId: string, amountCents: number, date: IsoDate, o: TxOpts = {}): Transaction {
  const detailed = o.detailed === undefined ? null : o.detailed;
  const primary =
    o.primary !== undefined
      ? o.primary
      : detailed === null
        ? null
        : (["TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS", "FOOD_AND_DRINK", "GENERAL_MERCHANDISE", "RENT_AND_UTILITIES", "INCOME", "TRAVEL", "TRANSPORTATION", "HOME_IMPROVEMENT", "ENTERTAINMENT"].find((p) =>
            detailed.startsWith(`${p}_`),
          ) ?? null);
  return {
    id,
    plaidTransactionId: `p_${id}`,
    accountId,
    amountCents,
    isoCurrencyCode: "USD",
    date,
    authorizedDate: o.authorizedDate === undefined ? date : o.authorizedDate,
    pending: o.pending ?? false,
    pendingTransactionId: null,
    rawDescription: o.raw ?? (o.merchantName ?? id).toUpperCase(),
    merchantName: o.merchantName === undefined ? null : o.merchantName,
    merchantEntityId: o.merchantEntityId ?? null,
    plaidCategoryPrimary: primary,
    plaidCategoryDetailed: detailed,
    plaidCategoryConfidence: null,
    isManual: accountId === "cash",
    removed: o.removed ?? false,
    removedAt: null,
    createdAt: `${date}T12:00:00.000Z`,
    updatedAt: `${date}T12:00:00.000Z`,
  };
}

export function flowsFixture(): FlowsFixture {
  const data = emptyData();
  data.accounts = [
    account("chk", "depository", "checking", { nickname: "Checking", mask: "0000" }),
    account("hysa", "depository", "savings", { nickname: "HYSA", mask: "1111" }),
    account("card", "credit", "credit card", { nickname: "Card", mask: "3333" }),
    account("brok", "investment", "brokerage", { nickname: "Brokerage", mask: "5555" }),
    account("cash", "other", null, { name: "Cash", isManual: true, kindOverride: "cash" }),
  ];
  const t: Transaction[] = [];
  const months = [
    { m: "2026-07", last: "31", dine: -4000 },
    { m: "2026-08", last: "31", dine: -5000 },
    { m: "2026-09", last: "30", dine: -6000 },
  ];
  for (const { m, last, dine } of months) {
    const k = m.slice(5);
    t.push(txn(`pay_${k}`, "chk", 300000, `${m}-01`, { merchantName: "Acme Corp", raw: "ACME CORP PAYROLL PPD", detailed: "INCOME_WAGES" }));
    t.push(txn(`rent_${k}`, "chk", -150000, `${m}-03`, { merchantName: "Oak Apartments", raw: "OAK APARTMENTS RENT", detailed: "RENT_AND_UTILITIES_RENT" }));
    t.push(txn(`hysa_out_${k}`, "chk", -50000, `${m}-05`, { raw: "ONLINE TRANSFER TO SAV XXXX1111", detailed: "TRANSFER_OUT_SAVINGS" }));
    t.push(txn(`hysa_in_${k}`, "hysa", 50000, `${m}-06`, { raw: "ONLINE TRANSFER FROM CHK XXXX0000", detailed: "TRANSFER_IN_SAVINGS" }));
    t.push(txn(`groc_${k}`, "card", -20000, `${m}-10`, { merchantName: "Trader Joe's", raw: "TRADER JOE'S #123", detailed: "FOOD_AND_DRINK_GROCERIES" }));
    t.push(txn(`dine_${k}`, "card", dine, `${m}-15`, { merchantName: "Nopa", raw: "NOPA SAN FRANCISCO", detailed: "FOOD_AND_DRINK_RESTAURANT" }));
    t.push(txn(`cardpay_out_${k}`, "chk", -30000, `${m}-25`, { raw: "PAYMENT TO CREDIT CARD XXXX3333", detailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" }));
    t.push(txn(`cardpay_in_${k}`, "card", 30000, `${m}-26`, { raw: "PAYMENT THANK YOU", detailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" }));
    t.push(txn(`interest_${k}`, "hysa", 4000, `${m}-${last}`, { authorizedDate: null, raw: "INTEREST PAYMENT", detailed: "INCOME_INTEREST_EARNED" }));
  }
  // September: Amazon purchase refunded in October (linked), and the trip's flight.
  t.push(txn("amazon_sep", "card", -10000, "2026-09-28", { raw: "AMAZON MKTP US*2K4AB1CD0", detailed: "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES" }));
  t.push(txn("trip_flight", "card", -50000, "2026-09-26", { merchantName: "TAP Air Portugal", detailed: "TRAVEL_FLIGHTS" }));
  // October (through the 20th).
  t.push(txn("pay_10", "chk", 300000, "2026-10-01", { merchantName: "Acme Corp", raw: "ACME CORP PAYROLL PPD", detailed: "INCOME_WAGES" }));
  t.push(txn("rent_10", "chk", -150000, "2026-10-03", { merchantName: "Oak Apartments", raw: "OAK APARTMENTS RENT", detailed: "RENT_AND_UTILITIES_RENT" }));
  t.push(txn("trip_cafe", "card", -20000, "2026-10-02", { merchantName: "Lisbon Cafe", detailed: "FOOD_AND_DRINK_RESTAURANT" }));
  t.push(txn("poker_in", "chk", 20000, "2026-10-04", { merchantName: "Venmo", raw: "VENMO CASHOUT FROM ALEX", detailed: "TRANSFER_IN_ACCOUNT_TRANSFER" }));
  for (let d = 2; d <= 7; d++) {
    t.push(txn(`coffee_${d}`, "card", -500, `2026-10-0${d}`, { merchantName: "Blue Bottle Coffee", raw: "SQ *BLUE BOTTLE COFFEE", detailed: "FOOD_AND_DRINK_COFFEE" }));
  }
  t.push(txn("amazon_refund", "card", 4000, "2026-10-05", { merchantName: "Amazon.com", raw: "AMAZON.COM REFUND", detailed: "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES" }));
  t.push(txn("hysa_out_10", "chk", -50000, "2026-10-05", { raw: "ONLINE TRANSFER TO SAV XXXX1111", detailed: "TRANSFER_OUT_SAVINGS" }));
  t.push(txn("hysa_in_10", "hysa", 50000, "2026-10-06", { raw: "ONLINE TRANSFER FROM CHK XXXX0000", detailed: "TRANSFER_IN_SAVINGS" }));
  t.push(txn("brok_out", "chk", -100000, "2026-10-07", { raw: "TRANSFER TO BROKERAGE", detailed: "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS" }));
  t.push(txn("brok_in", "brok", 100000, "2026-10-08", { raw: "CONTRIBUTION", detailed: "TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS" }));
  t.push(txn("brok_buy", "brok", -100000, "2026-10-09", { raw: "BUY VTI" }));
  t.push(txn("groc_10", "card", -21000, "2026-10-10", { authorizedDate: "2026-10-09", merchantName: "Trader Joe's", raw: "TRADER JOE'S #123", detailed: "FOOD_AND_DRINK_GROCERIES" }));
  t.push(txn("amazon_oct", "card", -2500, "2026-10-11", { merchantName: "Amazon", raw: "Amazon.com*AB12", detailed: "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES" }));
  t.push(txn("poker_out", "chk", -25000, "2026-10-11", { merchantName: "Venmo", raw: "VENMO PAYMENT TO SAM", detailed: "TRANSFER_OUT_ACCOUNT_TRANSFER" }));
  t.push(txn("dine_10a", "card", -9000, "2026-10-12", { merchantName: "Nopa", raw: "NOPA SAN FRANCISCO", detailed: "FOOD_AND_DRINK_RESTAURANT" }));
  t.push(txn("costco_split", "card", -15000, "2026-10-13", { merchantName: "Costco", raw: "COSTCO WHSE #0001", detailed: "GENERAL_MERCHANDISE_SUPERSTORES" }));
  t.push(txn("amazon_refund_unlinked", "card", 2500, "2026-10-14", { merchantName: "Amazon.com", raw: "AMAZON.COM REFUND", detailed: "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES" }));
  t.push(txn("netflix_a", "card", -1299, "2026-10-15", { merchantName: "Netflix", raw: "NETFLIX.COM", detailed: "ENTERTAINMENT_TV_AND_MOVIES" }));
  t.push(txn("netflix_b", "card", -1299, "2026-10-15", { merchantName: "Netflix", raw: "NETFLIX.COM", detailed: "ENTERTAINMENT_TV_AND_MOVIES" }));
  t.push(txn("dine_10b", "card", -8000, "2026-10-16", { merchantName: "Nopa", raw: "NOPA SAN FRANCISCO", detailed: "FOOD_AND_DRINK_RESTAURANT" }));
  t.push(txn("zelle_out", "chk", -3000, "2026-10-17", { raw: "ZELLE TO JORDAN", detailed: "TRANSFER_OUT_ACCOUNT_TRANSFER" }));
  t.push(txn("atm_out", "chk", -6000, "2026-10-18", { raw: "ATM WITHDRAWAL 123 MAIN ST", detailed: "TRANSFER_OUT_WITHDRAWAL" }));
  t.push(txn("cash_in", "cash", 6000, "2026-10-18", { authorizedDate: null, raw: "ATM cash" }));
  t.push(txn("tv_big", "card", -90000, "2026-10-18", { merchantName: "Best Buy", raw: "BEST BUY 00012", detailed: "GENERAL_MERCHANDISE_ELECTRONICS" }));
  t.push(txn("cash_market", "cash", -1500, "2026-10-19", { authorizedDate: null, raw: "Farmers market" }));
  t.push(txn("gas_pending", "card", -3500, "2026-10-19", { pending: true, merchantName: "Shell", raw: "SHELL OIL 5744", detailed: "TRANSPORTATION_GAS" }));
  t.push(txn("old_removed", "card", -99999, "2026-10-01", { removed: true, merchantName: "Gone", detailed: "GENERAL_MERCHANDISE_OTHER" }));
  data.transactions = t;

  data.investmentTransactions = [
    { id: "itx_div", plaidInvestmentTransactionId: "p_itx_div", accountId: "brok", securityId: "sec_vti", date: "2026-10-15", type: "cash", subtype: "dividend", amountCents: 2500, quantity: null, feesCents: 0, rawDescription: "VTI DIVIDEND", note: null },
    { id: "itx_buy", plaidInvestmentTransactionId: "p_itx_buy", accountId: "brok", securityId: "sec_vti", date: "2026-10-09", type: "buy", subtype: "buy", amountCents: -100000, quantity: 3.2, feesCents: 0, rawDescription: "BUY VTI", note: null },
  ];
  data.securities = [{ id: "sec_vti", plaidSecurityId: "psec_vti", name: "Vanguard Total Stock Market ETF", tickerSymbol: "VTI", type: "etf" }];

  data.splits = [
    { id: "split_food", transactionId: "costco_split", amountCents: -9000, category: "FOOD_AND_DRINK_GROCERIES", necessity: null, note: null, position: 0 },
    { id: "split_home", transactionId: "costco_split", amountCents: -6000, category: "HOME_IMPROVEMENT_FURNITURE", necessity: null, note: "Shelf", position: 1 },
  ];
  data.refundLinks = [
    { id: "rl_amazon", refundTransactionId: "amazon_refund", purchaseTransactionId: "amazon_sep", source: "manual", undoneAt: null, needsReview: false, createdAt: "2026-10-05T13:00:00.000Z" },
  ];
  data.transferLinks = [
    { id: "tl_atm", outTransactionId: "atm_out", inTransactionId: "cash_in", source: "manual", undoneAt: null, needsReview: false, createdAt: "2026-10-18T13:00:00.000Z" },
  ];
  data.rules = [
    { id: "rule_poker_in", position: 0, matchKind: "description_contains", matchValue: "VENMO CASHOUT FROM ALEX", accountId: null, setCategory: null, setBucket: "poker", setNecessity: null, enabled: true, createdAt: T0 },
    { id: "rule_poker_out", position: 1, matchKind: "description_contains", matchValue: "VENMO PAYMENT TO SAM", accountId: null, setCategory: null, setBucket: "poker", setNecessity: null, enabled: true, createdAt: T0 },
  ];
  data.overrides = [
    { transactionId: "dine_10b", category: null, bucket: null, necessity: "necessary", note: "Work dinner", confirmedAt: null, updatedAt: "2026-10-16T20:00:00.000Z" },
  ];
  data.tags = [{ id: "tag_lisbon", name: "Lisbon trip", createdAt: T0 }];
  data.transactionTags = [
    { transactionId: "trip_flight", tagId: "tag_lisbon" },
    { transactionId: "trip_cafe", tagId: "tag_lisbon" },
  ];
  data.trips = [{ id: "trip_lisbon", tagId: "tag_lisbon", name: "Lisbon", startDate: "2026-09-25", endDate: "2026-10-04", expectedCents: 100000 }];
  data.necessaryLabels = [
    { id: "nl_groc", targetKind: "category", targetValue: "FOOD_AND_DRINK_GROCERIES", necessity: "necessary" },
    { id: "nl_rent", targetKind: "category", targetValue: "RENT_AND_UTILITIES", necessity: "necessary" },
    { id: "nl_nopa", targetKind: "merchant", targetValue: "auto:NOPA", necessity: "not_necessary" },
    { id: "nl_food", targetKind: "category", targetValue: "FOOD_AND_DRINK", necessity: "necessary" },
  ];
  data.cuttingBack = [{ id: "cb_nopa", targetKind: "merchant", targetValue: "auto:NOPA", startedOn: "2026-10-01", endedOn: null }];
  data.recurringItems = [
    {
      id: "rec_netflix", plaidStreamId: null, source: "auto", accountId: "card", direction: "outflow", description: "NETFLIX.COM", merchantName: "Netflix", category: "ENTERTAINMENT_TV_AND_MOVIES",
      frequency: "monthly", averageAmountCents: -1299, lastAmountCents: -1299, lastDate: "2026-10-15", predictedNextDate: "2026-11-15", isActive: true, plaidStatus: null, firstSeenOn: "2026-10-15",
    },
  ];
  data.recurringItemTransactions = [{ recurringItemId: "rec_netflix", transactionId: "netflix_a" }];

  data.budgets = [{ id: "budget_monthly", name: "Monthly", periodKind: "monthly", anchorDate: "2026-07-01", customEndDate: null, archivedAt: null, createdAt: T0 }];
  data.budgetAmounts = [
    { budgetId: "budget_monthly", effectiveFrom: "2026-07-01", amountCents: 300000 },
    { budgetId: "budget_monthly", effectiveFrom: "2026-10-01", amountCents: 320000 },
  ];
  data.budgetParts = [
    { id: "part_eat", budgetId: "budget_monthly", name: "Eating out", expectedCents: 15000, effectiveFrom: "2026-07-01", effectiveTo: null, position: 0 },
    { id: "part_groc", budgetId: "budget_monthly", name: "Groceries", expectedCents: 25000, effectiveFrom: "2026-07-01", effectiveTo: null, position: 1 },
    { id: "part_amz", budgetId: "budget_monthly", name: "Amazon", expectedCents: 5000, effectiveFrom: "2026-07-01", effectiveTo: null, position: 2 },
  ];
  data.budgetPartTargets = [
    { partId: "part_eat", targetKind: "category", targetValue: "FOOD_AND_DRINK_RESTAURANT" },
    { partId: "part_eat", targetKind: "category", targetValue: "FOOD_AND_DRINK_COFFEE" },
    { partId: "part_groc", targetKind: "category", targetValue: "FOOD_AND_DRINK_GROCERIES" },
    { partId: "part_amz", targetKind: "merchant", targetValue: "auto:AMAZON" },
  ];

  // Snapshots: Sep 30 and Oct 20. Checking is off by $12.34 (unexplained),
  // the brokerage by $77.77 (market change); the cash account has none.
  const net = (acc: string, after: IsoDate, to: IsoDate) =>
    t.filter((x) => x.accountId === acc && !x.pending && !x.removed && x.date > after && x.date <= to).reduce((s, x) => s + x.amountCents, 0);
  const snap = (accountId: string, date: IsoDate, balanceCents: number): BalanceSnapshot => ({
    accountId,
    date,
    balanceCents,
    source: "plaid",
    isEstimated: false,
    isCarriedForward: false,
  });
  const start = { chk: 500000, hysa: 1000000, card: -30000, brok: 2000000 };
  data.balanceSnapshots = [
    snap("chk", "2026-09-30", start.chk),
    snap("chk", "2026-10-20", start.chk + net("chk", "2026-09-30", "2026-10-20") + 1234),
    snap("hysa", "2026-09-30", start.hysa),
    snap("hysa", "2026-10-20", start.hysa + net("hysa", "2026-09-30", "2026-10-20")),
    snap("card", "2026-09-30", start.card),
    snap("card", "2026-10-20", start.card + net("card", "2026-09-30", "2026-10-20")),
    snap("brok", "2026-09-30", start.brok),
    snap("brok", "2026-10-20", start.brok + net("brok", "2026-09-30", "2026-10-20") + 2500 + 7777),
  ];
  return { today: "2026-10-20", data };
}
