/**
 * Deterministic dev seed: the same `today` always produces exactly the same
 * data (a seeded PRNG, no clock reads). Covers the cases the math must handle
 * (§1): paychecks, transfers between linked accounts, card purchases and card
 * payments, a refund, interest, pending → posted, a split, Poker, an ATM
 * withdrawal into a manual cash account, investment holdings and dividends.
 *
 * Six full months of history end at `today`. Used by `npm run reset:dev`.
 */
import {
  addDays,
  addMonths,
  emptyData,
  endOfMonth,
  startOfMonth,
  type CoreData,
  type IsoDate,
  type Transaction,
} from "@ft/core";

/** Mulberry32: tiny deterministic PRNG. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MERCHANTS = [
  { desc: "SQ *BLUE BOTTLE COFFEE", merchant: "Blue Bottle Coffee", entity: "ent_bluebottle", primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_COFFEE", min: 450, max: 900 },
  { desc: "TRADER JOE'S #123", merchant: "Trader Joe's", entity: "ent_tj", primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_GROCERIES", min: 3000, max: 12000 },
  { desc: "WHOLE FOODS MARKET #10233", merchant: "Whole Foods", entity: "ent_wholefoods", primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_GROCERIES", min: 2500, max: 9000 },
  { desc: "CHIPOTLE 2231", merchant: "Chipotle", entity: "ent_chipotle", primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_FAST_FOOD", min: 1100, max: 1800 },
  { desc: "THE GOOD PLACE RESTAURANT", merchant: "The Good Place", entity: "ent_goodplace", primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_RESTAURANT", min: 4000, max: 11000 },
  { desc: "AMAZON MKTP US*2K4AB1CD0", merchant: "Amazon", entity: "ent_amazon", primary: "GENERAL_MERCHANDISE", detailed: "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES", min: 1500, max: 15000 },
  { desc: "SHELL OIL 5744", merchant: "Shell", entity: "ent_shell", primary: "TRANSPORTATION", detailed: "TRANSPORTATION_GAS", min: 3500, max: 6500 },
  { desc: "UBER *TRIP", merchant: "Uber", entity: "ent_uber", primary: "TRANSPORTATION", detailed: "TRANSPORTATION_TAXIS_AND_RIDE_SHARES", min: 1200, max: 4000 },
  { desc: "UNIQLO USA", merchant: "Uniqlo", entity: "ent_uniqlo", primary: "GENERAL_MERCHANDISE", detailed: "GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES", min: 2000, max: 9000 },
] as const;

const CREATED = "2026-01-01T00:00:00.000Z";

export function buildDevSeed(today: IsoDate): CoreData {
  const rand = prng(20261118);
  const between = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
  const data = emptyData();
  const first = startOfMonth(addMonths(today, -6));
  const connectedOn = first;

  data.items.push({
    id: "item_dev_bank",
    plaidItemId: "dev-item-bank",
    institutionId: "ins_dev_platypus",
    institutionName: "First Platypus Bank (seed)",
    status: "ok",
    errorCode: null,
    consentExpiresAt: null,
    lastSuccessfulUpdateAt: `${today}T06:00:00.000Z`,
    lastSyncedAt: `${today}T06:00:05.000Z`,
    createdAt: `${connectedOn}T12:00:00.000Z`,
  });

  const account = (id: string, name: string, type: "depository" | "credit" | "investment" | "other", subtype: string | null, mask: string | null, extra: Partial<CoreData["accounts"][number]> = {}) =>
    data.accounts.push({
      id,
      itemId: type === "other" ? null : "item_dev_bank",
      plaidAccountId: type === "other" ? null : `dev_${id}`,
      name,
      nickname: null,
      mask,
      type,
      subtype,
      kindOverride: null,
      isManual: type === "other",
      hidden: false,
      protectedAmountCents: 0,
      incomeFallback: false,
      isoCurrencyCode: "USD",
      currentBalanceCents: 0,
      balanceUpdatedAt: `${today}T06:00:00.000Z`,
      connectedOn,
      createdAt: `${connectedOn}T12:00:00.000Z`,
      ...extra,
    });
  account("acc_checking", "Everyday Checking", "depository", "checking", "0101");
  account("acc_hysa", "High Yield Savings", "depository", "savings", "0202", { protectedAmountCents: 500_000 });
  account("acc_card", "Everyday Credit Card", "credit", "credit card", "0303");
  account("acc_brokerage", "Brokerage", "investment", "brokerage", "0505");
  account("acc_cash", "Cash", "other", null, null, { kindOverride: "cash", balanceUpdatedAt: null });

  let n = 0;
  const tx = (accountId: string, date: IsoDate, amountCents: number, desc: string, cat: [string | null, string | null], extra: Partial<Transaction> = {}): Transaction => {
    const id = `tx_${String(++n).padStart(4, "0")}`;
    const t: Transaction = {
      id,
      plaidTransactionId: accountId === "acc_cash" ? null : `dev_${id}`,
      accountId,
      amountCents,
      isoCurrencyCode: "USD",
      date,
      authorizedDate: date,
      pending: false,
      pendingTransactionId: null,
      rawDescription: desc,
      merchantName: null,
      merchantEntityId: null,
      plaidCategoryPrimary: cat[0],
      plaidCategoryDetailed: cat[1],
      plaidCategoryConfidence: cat[0] ? "HIGH" : null,
      isManual: accountId === "acc_cash",
      removed: false,
      removedAt: null,
      createdAt: `${date}T06:00:00.000Z`,
      updatedAt: `${date}T06:00:00.000Z`,
      ...extra,
    };
    if (date <= today) data.transactions.push(t);
    return t;
  };
  const link = (out: Transaction, into: Transaction, source: "auto" | "manual" = "auto") => {
    if (out.date > today || into.date > today) return;
    data.transferLinks.push({ id: `tl_${out.id}`, outTransactionId: out.id, inTransactionId: into.id, source, undoneAt: null, needsReview: false, createdAt: into.createdAt });
  };

  for (let m = 0; m <= 6; m++) {
    const monthStart = addMonths(first, m);
    if (monthStart > today) break;
    const monthEnd = endOfMonth(monthStart);

    // Paychecks on the 1st and 15th.
    for (const day of [0, 14]) tx("acc_checking", addDays(monthStart, day), 250_000, "ACME CORP PAYROLL PPD ID: 1234", ["INCOME", "INCOME_WAGES"], { merchantName: "Acme Corp" });
    // Rent.
    tx("acc_checking", addDays(monthStart, 4), -185_000, "OAKWOOD APARTMENTS RENT", ["RENT_AND_UTILITIES", "RENT_AND_UTILITIES_RENT"], { merchantName: "Oakwood Apartments" });
    // Utilities (varying bill).
    tx("acc_checking", addDays(monthStart, 9), -between(6000, 11000), "CITY POWER & LIGHT", ["RENT_AND_UTILITIES", "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY"], { merchantName: "City Power" });
    // Checking → HYSA transfer, both halves.
    link(
      tx("acc_checking", addDays(monthStart, 2), -50_000, "ONLINE TRANSFER TO SAV XXXX0202", ["TRANSFER_OUT", "TRANSFER_OUT_SAVINGS"]),
      tx("acc_hysa", addDays(monthStart, 3), 50_000, "ONLINE TRANSFER FROM CHK XXXX0101", ["TRANSFER_IN", "TRANSFER_IN_SAVINGS"]),
    );
    // Checking → brokerage contribution (other half lives in investment transactions).
    tx("acc_checking", addDays(monthStart, 3), -30_000, "BROKERAGE CONTRIBUTION", ["TRANSFER_OUT", "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS"]);
    data.investmentTransactions.push({
      id: `itx_contrib_${m}`,
      plaidInvestmentTransactionId: `dev_itx_contrib_${m}`,
      accountId: "acc_brokerage",
      securityId: null,
      date: addDays(monthStart, 4),
      type: "cash",
      subtype: "contribution",
      amountCents: 30_000,
      quantity: null,
      feesCents: 0,
      rawDescription: "ACH DEPOSIT",
      note: null,
    });
    // Interest on the HYSA and checking at month end.
    if (monthEnd <= today) {
      tx("acc_hysa", monthEnd, between(3000, 4500), "INTEREST PAYMENT", ["INCOME", "INCOME_INTEREST_EARNED"]);
      tx("acc_checking", monthEnd, between(30, 60), "INTEREST PAYMENT", ["INCOME", "INCOME_INTEREST_EARNED"]);
      data.investmentTransactions.push({
        id: `itx_div_${m}`,
        plaidInvestmentTransactionId: `dev_itx_div_${m}`,
        accountId: "acc_brokerage",
        securityId: "sec_vti",
        date: monthEnd,
        type: "cash",
        subtype: "dividend",
        amountCents: between(2500, 4000),
        quantity: null,
        feesCents: 0,
        rawDescription: "VTI DIVIDEND",
        note: null,
      });
    }

    // Card purchases spread over the month.
    for (let i = 0; i < 18; i++) {
      const merchant = MERCHANTS[Math.floor(rand() * MERCHANTS.length)]!;
      const amount = between(merchant.min, merchant.max);
      const date = addDays(monthStart, Math.floor(rand() * 28));
      tx("acc_card", date, -amount, merchant.desc, [merchant.primary, merchant.detailed], {
        merchantName: merchant.merchant,
        merchantEntityId: merchant.entity,
        authorizedDate: addDays(date, -1) >= monthStart ? addDays(date, -1) : date,
      });
    }
    // Card payment from checking on the 25th, both halves.
    if (m > 0) {
      const amount = between(80_000, 140_000);
      link(
        tx("acc_checking", addDays(monthStart, 24), -amount, "PAYMENT TO EVERYDAY CREDIT CARD XXXX0303", ["LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"]),
        tx("acc_card", addDays(monthStart, 25), amount, "PAYMENT THANK YOU", ["LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"]),
      );
    }
    // Netflix.
    tx("acc_card", addDays(monthStart, 1), -1549, "NETFLIX.COM", ["ENTERTAINMENT", "ENTERTAINMENT_TV_AND_MOVIES"], { merchantName: "Netflix", merchantEntityId: "ent_netflix" });
  }

  // Specific cases near the end of the range.
  // TODO(revisit): Sandbox custom users can't set merchant names or pending→posted transitions; those cases come from this seed and user_transactions_dynamic.
  const lastFull = startOfMonth(addMonths(today, -1));
  const purchase = tx("acc_card", addDays(lastFull, 6), -12_999, "AMAZON MKTP US*9ZZ88YY", ["GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES"], { merchantName: "Amazon", merchantEntityId: "ent_amazon" });
  const refund = tx("acc_card", addDays(today, -3), 2_999, "AMAZON.COM REFUND", ["GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES"], { merchantName: "Amazon", merchantEntityId: "ent_amazon" });
  data.refundLinks.push({ id: "rl_amazon", refundTransactionId: refund.id, purchaseTransactionId: purchase.id, source: "manual", undoneAt: null, needsReview: false, createdAt: refund.createdAt });

  const costco = tx("acc_card", addDays(lastFull, 9), -15_000, "COSTCO WHSE #0001", ["GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_SUPERSTORES"], { merchantName: "Costco", merchantEntityId: "ent_costco" });
  data.splits.push(
    { id: "split_costco_food", transactionId: costco.id, amountCents: -9_000, category: "FOOD_AND_DRINK_GROCERIES", necessity: null, note: null, position: 0 },
    { id: "split_costco_home", transactionId: costco.id, amountCents: -6_000, category: "HOME_IMPROVEMENT_FURNITURE", necessity: null, note: null, position: 1 },
  );

  const pokerIn = tx("acc_checking", addDays(lastFull, 11), 12_000, "VENMO CASHOUT FROM ALEX", ["TRANSFER_IN", "TRANSFER_IN_ACCOUNT_TRANSFER"], { merchantName: "Venmo", plaidCategoryConfidence: "MEDIUM" });
  const pokerOut = tx("acc_checking", addDays(lastFull, 12), -8_000, "VENMO PAYMENT TO SAM", ["TRANSFER_OUT", "TRANSFER_OUT_ACCOUNT_TRANSFER"], { merchantName: "Venmo", plaidCategoryConfidence: "MEDIUM" });
  for (const t of [pokerIn, pokerOut]) {
    data.overrides.push({ transactionId: t.id, category: null, bucket: "poker", necessity: null, note: t === pokerIn ? "Thursday game buy-ins" : null, confirmedAt: null, updatedAt: t.createdAt });
  }
  data.rules.push({ id: "rule_venmo_poker", position: 0, matchKind: "description_contains", matchValue: "VENMO", accountId: "acc_checking", setCategory: null, setBucket: "poker", setNecessity: null, enabled: true, createdAt: CREATED });

  link(
    tx("acc_checking", addDays(lastFull, 13), -6_000, "ATM WITHDRAWAL 123 MAIN ST", ["TRANSFER_OUT", "TRANSFER_OUT_WITHDRAWAL"]),
    tx("acc_cash", addDays(lastFull, 13), 6_000, "ATM cash", [null, null]),
    "manual",
  );
  tx("acc_cash", addDays(lastFull, 14), -2_500, "Farmers market", [null, null]);

  // Pending → posted: the pending row was replaced (removed) by its posted version.
  const pending = tx("acc_card", addDays(today, -4), -4_567, "TRADER JOE'S #123", ["FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"], { pending: true, merchantName: "Trader Joe's", merchantEntityId: "ent_tj" });
  pending.removed = true;
  pending.removedAt = `${addDays(today, -2)}T06:00:00.000Z`;
  tx("acc_card", addDays(today, -2), -4_567, "TRADER JOE'S #123", ["FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"], { merchantName: "Trader Joe's", merchantEntityId: "ent_tj", authorizedDate: addDays(today, -4), pendingTransactionId: pending.plaidTransactionId });
  // Still pending today.
  tx("acc_card", addDays(today, -1), -3_500, "SHELL OIL 5744", ["TRANSPORTATION", "TRANSPORTATION_GAS"], { pending: true, merchantName: "Shell", merchantEntityId: "ent_shell" });

  // Balances: sum of the seeded transactions on top of an opening balance (so replay is exact).
  const opening: Record<string, number> = { acc_checking: 300_000, acc_hysa: 1_000_000, acc_card: -40_000, acc_brokerage: 0, acc_cash: 0 };
  for (const a of data.accounts) {
    const sum = data.transactions.filter((t) => t.accountId === a.id && !t.pending && !t.removed).reduce((s, t) => s + t.amountCents, 0);
    a.currentBalanceCents = (opening[a.id] ?? 0) + sum;
  }

  // Investments.
  data.securities.push(
    { id: "sec_vti", plaidSecurityId: "dev_sec_vti", name: "Vanguard Total Stock Market ETF", tickerSymbol: "VTI", type: "etf" },
    { id: "sec_vxus", plaidSecurityId: "dev_sec_vxus", name: "Vanguard Total International Stock ETF", tickerSymbol: "VXUS", type: "etf" },
    { id: "sec_cash", plaidSecurityId: "dev_sec_cash", name: "U S Dollar", tickerSymbol: "CUR:USD", type: "cash" },
  );
  data.holdings.push(
    { accountId: "acc_brokerage", securityId: "sec_vti", asOfDate: today, quantity: 50, valueCents: 1_492_550, isoCurrencyCode: "USD" },
    { accountId: "acc_brokerage", securityId: "sec_vxus", asOfDate: today, quantity: 95.5, valueCents: 614_065, isoCurrencyCode: "USD" },
    { accountId: "acc_brokerage", securityId: "sec_cash", asOfDate: today, quantity: 12_345.67, valueCents: 1_234_567, isoCurrencyCode: "USD" },
  );
  const brokerage = data.accounts.find((a) => a.id === "acc_brokerage")!;
  brokerage.currentBalanceCents = data.holdings.reduce((s, h) => s + h.valueCents, 0);

  data.liabilities.push({
    accountId: "acc_card",
    lastStatementBalanceCents: 98_765,
    lastStatementIssueDate: addDays(startOfMonth(today), 9) <= today ? addDays(startOfMonth(today), 9) : addDays(lastFull, 9),
    nextPaymentDueDate: addDays(startOfMonth(addMonths(today, 1)), 4),
    minimumPaymentCents: 3_500,
    payingAccountId: "acc_checking",
    updatedAt: `${today}T06:00:00.000Z`,
  });

  data.recurringItems.push(
    { id: "rec_rent", plaidStreamId: "dev_stream_rent", source: "auto", accountId: "acc_checking", direction: "outflow", description: "OAKWOOD APARTMENTS RENT", merchantName: "Oakwood Apartments", category: "RENT_AND_UTILITIES_RENT", frequency: "monthly", averageAmountCents: -185_000, lastAmountCents: -185_000, lastDate: addDays(startOfMonth(today), 4) <= today ? addDays(startOfMonth(today), 4) : addDays(lastFull, 4), predictedNextDate: addDays(startOfMonth(addMonths(today, 1)), 4), isActive: true, plaidStatus: "MATURE", firstSeenOn: connectedOn },
    { id: "rec_netflix", plaidStreamId: "dev_stream_netflix", source: "auto", accountId: "acc_card", direction: "outflow", description: "NETFLIX.COM", merchantName: "Netflix", category: "ENTERTAINMENT_TV_AND_MOVIES", frequency: "monthly", averageAmountCents: -1_549, lastAmountCents: -1_549, lastDate: addDays(startOfMonth(today), 1) <= today ? addDays(startOfMonth(today), 1) : addDays(lastFull, 1), predictedNextDate: addDays(startOfMonth(addMonths(today, 1)), 1), isActive: true, plaidStatus: "MATURE", firstSeenOn: connectedOn },
    { id: "rec_payroll", plaidStreamId: "dev_stream_payroll", source: "auto", accountId: "acc_checking", direction: "inflow", description: "ACME CORP PAYROLL", merchantName: "Acme Corp", category: "INCOME_WAGES", frequency: "semi_monthly", averageAmountCents: 250_000, lastAmountCents: 250_000, lastDate: null, predictedNextDate: null, isActive: true, plaidStatus: "MATURE", firstSeenOn: connectedOn },
  );

  data.tags.push({ id: "tag_lisbon", name: "Lisbon trip", createdAt: CREATED });
  data.budgets.push({ id: "budget_monthly", name: "Monthly spending", periodKind: "monthly", anchorDate: first, customEndDate: null, archivedAt: null, createdAt: CREATED });
  data.budgetAmounts.push({ budgetId: "budget_monthly", effectiveFrom: first, amountCents: 400_000 });
  data.budgetParts.push(
    { id: "part_eating_out", budgetId: "budget_monthly", name: "Eating out", expectedCents: 40_000, effectiveFrom: first, effectiveTo: null, position: 0 },
    { id: "part_groceries", budgetId: "budget_monthly", name: "Groceries", expectedCents: 60_000, effectiveFrom: first, effectiveTo: null, position: 1 },
  );
  data.budgetPartTargets.push(
    { partId: "part_eating_out", targetKind: "category", targetValue: "FOOD_AND_DRINK_RESTAURANT" },
    { partId: "part_eating_out", targetKind: "category", targetValue: "FOOD_AND_DRINK_FAST_FOOD" },
    { partId: "part_eating_out", targetKind: "category", targetValue: "FOOD_AND_DRINK_COFFEE" },
    { partId: "part_groceries", targetKind: "category", targetValue: "FOOD_AND_DRINK_GROCERIES" },
  );
  data.goals.push(
    { id: "goal_dgx", name: "DGX Spark", accountId: "acc_hysa", targetCents: 400_000, priority: 1, deadline: addMonths(today, 6), expectedContributionCents: 30_000, contributionPeriod: "monthly", colorSlot: 0, completedAt: null, archivedAt: null, purchaseTransactionId: null, createdAt: CREATED },
    { id: "goal_trip", name: "Lisbon trip", accountId: "acc_hysa", targetCents: 250_000, priority: 2, deadline: null, expectedContributionCents: null, contributionPeriod: null, colorSlot: 1, completedAt: null, archivedAt: null, purchaseTransactionId: null, createdAt: CREATED },
  );
  data.necessaryLabels.push({ id: "nl_groceries", targetKind: "category", targetValue: "FOOD_AND_DRINK_GROCERIES", necessity: "necessary" });

  for (const a of data.accounts) {
    data.balanceSnapshots.push({ accountId: a.id, date: today, balanceCents: a.currentBalanceCents ?? 0, source: a.isManual ? "manual" : "plaid", isEstimated: false, isCarriedForward: false });
  }
  return data;
}
