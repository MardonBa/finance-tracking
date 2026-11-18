import { describe, expect, it } from "vitest";
import {
  cardPaymentsDue,
  mergeRecurring,
  monthCalendar,
  nextOnOrAfter,
  occurrence,
  occurrencesBetween,
  upcomingProjections,
  type MergeInput,
} from "../../src/recurring/index.ts";
import type { Liability, RecurringOverride } from "../../src/types.ts";
import { account, recurring, tx } from "./builders.ts";

const TODAY = "2026-11-18";

function override(recurringItemId: string, over: Partial<RecurringOverride>): RecurringOverride {
  return { recurringItemId, name: null, amountCents: null, nextDate: null, accountId: null, frequency: null, removed: false, updatedAt: "2026-11-01T00:00:00.000Z", ...over };
}

function input(over: Partial<MergeInput>): MergeInput {
  return { recurringItems: [], recurringOverrides: [], recurringItemTransactions: [], transactions: [], today: TODAY, ...over };
}

describe("schedule", () => {
  it("steps every frequency without drifting", () => {
    expect(occurrence("2026-01-31", "monthly", 1)).toBe("2026-02-28");
    expect(occurrence("2026-01-31", "monthly", 2)).toBe("2026-03-31");
    expect(occurrence("2026-01-01", "biweekly", -1)).toBe("2025-12-18");
    expect(occurrence("2024-02-29", "annually", 1)).toBe("2025-02-28");
    expect([0, 1, 2, 3, -1].map((k) => occurrence("2026-01-16", "semi_monthly", k))).toEqual([
      "2026-01-16",
      "2026-02-01",
      "2026-02-16",
      "2026-03-01",
      "2026-01-01",
    ]);
    expect(occurrence("2026-01-01", "unknown", 1)).toBeNull();
    expect(occurrencesBetween("2026-11-03", "weekly", "2026-10-01", "2026-10-31")).toEqual(["2026-10-06", "2026-10-13", "2026-10-20", "2026-10-27"]);
    expect(nextOnOrAfter("2026-01-05", "monthly", TODAY)).toBe("2026-12-05");
  });
});

describe("§9 merging Plaid streams with my edits", () => {
  const netflix = recurring({ id: "netflix", description: "NETFLIX.COM", merchantName: "Netflix", predictedNextDate: "2026-11-25", lastAmountCents: 1549 });
  const power = recurring({ id: "power", merchantName: "PG&E", predictedNextDate: "2026-11-28" });
  const powerTxs = [tx("acc_checking", "2026-08-28", -8000, { id: "p1" }), tx("acc_checking", "2026-09-28", -9500, { id: "p2" }), tx("acc_checking", "2026-10-28", -12000, { id: "p3" })];
  const netflixTxs = [tx("acc_checking", "2026-09-25", -1549, { id: "n1" }), tx("acc_checking", "2026-10-25", -1799, { id: "n2" })];
  const links = [...powerTxs.map((t) => ({ recurringItemId: "power", transactionId: t.id })), ...netflixTxs.map((t) => ({ recurringItemId: "netflix", transactionId: t.id }))];
  const base = input({ recurringItems: [netflix, power], recurringItemTransactions: links, transactions: [...powerTxs, ...netflixTxs] });

  it("estimates variable bills from recent amounts and marks them", () => {
    const r = mergeRecurring(base);
    const p = r.items.find((i) => i.id === "power")!;
    expect(p.isEstimate).toBe(true);
    expect(p.amountCents).toBe(Math.round((8000 + 9500 + 12000) / 3));
    expect(p.estimateBasis).toEqual({ amountsCents: [8000, 9500, 12000], transactionIds: ["p1", "p2", "p3"] });
    expect(p.priceChange).toBeNull(); // variable bills don't flag price changes
  });

  it("treats amounts that vary by more than 5% as a variable bill", () => {
    const n = mergeRecurring(base).items.find((i) => i.id === "netflix")!;
    expect(n.isEstimate).toBe(true); // 1549 vs 1799 differ by 15%
    expect(n.amountCents).toBe(1674);
  });

  it("a small fixed-price change is a price change, not an estimate", () => {
    const t = [tx("acc_checking", "2026-09-25", -1549, { id: "s1" }), tx("acc_checking", "2026-10-25", -1599, { id: "s2" })];
    const r = mergeRecurring(input({ recurringItems: [netflix], recurringItemTransactions: t.map((x) => ({ recurringItemId: "netflix", transactionId: x.id })), transactions: t }));
    const n = r.items[0]!;
    expect(n.isEstimate).toBe(false);
    expect(n.amountCents).toBe(1599);
    expect(n.priceChange).toEqual({ fromCents: 1549, toCents: 1599, changedOn: "2026-10-25", message: "Netflix changed from $15.49 to $15.99." });
    expect(r.priceChanges.map((i) => i.id)).toEqual(["netflix"]);
  });

  it("applies edits (name, amount, date, account, frequency) and removals", () => {
    const r = mergeRecurring({
      ...base,
      recurringOverrides: [
        override("power", { name: "Electric", amountCents: 10000, nextDate: "2026-12-02", accountId: "acc_hysa", frequency: "monthly" }),
        override("netflix", { removed: true }),
      ],
    });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ name: "Electric", amountCents: 10000, isEstimate: false, nextDate: "2026-12-02", accountId: "acc_hysa" });
    expect(r.items[0]!.editedFields).toEqual(["name", "amount", "nextDate", "account", "frequency"]);
    expect(r.removed).toEqual([{ id: "netflix", name: "Netflix" }]);
  });

  it("includes items I added, lists new charges quietly, and drops stopped streams", () => {
    const mine = recurring({ id: "gym", source: "manual", plaidStreamId: null, description: "Gym", merchantName: null, averageAmountCents: 4000, lastAmountCents: null, predictedNextDate: "2026-12-01" });
    const fresh = recurring({ id: "new", merchantName: "Spotify", firstSeenOn: "2026-11-01", predictedNextDate: "2026-12-01" });
    const dead = recurring({ id: "dead", isActive: false });
    const r = mergeRecurring(input({ recurringItems: [mine, fresh, dead] }));
    expect(r.items.map((i) => i.id).sort()).toEqual(["gym", "new"]);
    expect(r.items.find((i) => i.id === "gym")).toMatchObject({ source: "manual", amountCents: 4000, isNew: false });
    expect(r.newCharges.map((i) => i.id)).toEqual(["new"]);
    expect(r.inactive).toEqual([{ id: "dead", name: "dead" }]);
  });

  it("rolls a stale predicted date forward to today or later", () => {
    const old = recurring({ id: "old", predictedNextDate: "2026-09-10" });
    expect(mergeRecurring(input({ recurringItems: [old] })).items[0]!.nextDate).toBe("2026-12-10");
  });
});

describe("§9 upcoming projection, lowest point and below-zero warning", () => {
  const checking = account({ id: "acc_checking", nickname: "Checking", currentBalanceCents: 50000 });
  const card = account({ id: "acc_card", type: "credit", subtype: "credit card", name: "Visa", currentBalanceCents: -60000 });
  const liability: Liability = {
    accountId: "acc_card",
    lastStatementBalanceCents: 45000,
    lastStatementIssueDate: "2026-11-01",
    nextPaymentDueDate: "2026-11-25",
    minimumPaymentCents: 3500,
    payingAccountId: "acc_checking",
    updatedAt: "2026-11-18T00:00:00.000Z",
  };
  const items = [
    recurring({ id: "rent", merchantName: "Rent", predictedNextDate: "2026-11-20", averageAmountCents: 30000, lastAmountCents: 30000 }),
    recurring({ id: "phone", merchantName: "Phone", predictedNextDate: "2026-11-27", averageAmountCents: 5000, lastAmountCents: 5000 }),
    recurring({ id: "late", merchantName: "After pay", predictedNextDate: "2026-12-05", averageAmountCents: 999, lastAmountCents: 999 }),
    recurring({ id: "pay", direction: "inflow", merchantName: "Acme payroll", frequency: "semi_monthly", predictedNextDate: "2026-12-01", averageAmountCents: 250000, lastAmountCents: 250000 }),
  ];

  function project(payments: ReturnType<typeof tx>[] = [], extra: Partial<MergeInput> = {}) {
    const merged = mergeRecurring(input({ recurringItems: items, ...extra })).items;
    const cardPayments = cardPaymentsDue({ accounts: [checking, card], liabilities: [liability], transactions: payments, transferLinks: [], today: TODAY });
    return upcomingProjections({ accounts: [checking, card], items: merged, cardPayments, today: TODAY });
  }

  it("lists every charge before the next income, including the card statement, and the lowest point", () => {
    const [p] = project();
    expect(p!.accountId).toBe("acc_checking");
    expect(p!.nextIncome).toMatchObject({ date: "2026-12-01", amountCents: 250000 });
    expect(p!.events.map((e) => [e.date, e.kind, e.amountCents, e.balanceAfterCents])).toEqual([
      ["2026-11-20", "charge", -30000, 20000],
      ["2026-11-25", "card_payment", -45000, -25000],
      ["2026-11-27", "charge", -5000, -30000],
      ["2026-12-01", "income", 250000, 220000],
    ]);
    expect(p!.lowestPoint).toEqual({ cents: -30000, date: "2026-11-27" });
    expect(p!.warning).toMatchObject({ accountId: "acc_checking", shortfallCents: 30000, date: "2026-11-25" });
    expect(p!.warning!.message).toBe("Checking is projected to be $300.00 short on 2026-11-25.");
    expect(p!.basis[0]).toMatch(/today's balance of \$500\.00/);
    expect(p!.basis).toContain("2026-11-25: Visa statement -$450.00");
  });

  it("subtracts card payments already made since the statement", () => {
    const paid = tx("acc_card", "2026-11-10", 45000, { plaidCategoryPrimary: "LOAN_PAYMENTS", id: "pay1" });
    const [p] = project([paid]);
    expect(p!.events.some((e) => e.kind === "card_payment")).toBe(false);
    expect(p!.warning).toBeNull();
    const partial = cardPaymentsDue({
      accounts: [card],
      liabilities: [liability],
      transactions: [tx("acc_card", "2026-11-10", 10000, { id: "x" })],
      transferLinks: [{ id: "l", outTransactionId: "o", inTransactionId: "x", source: "auto", undoneAt: null, needsReview: false, createdAt: "" }],
      today: TODAY,
    });
    expect(partial[0]).toMatchObject({ amountCents: 35000, paidCents: 10000, paymentTransactionIds: ["x"] });
  });

  it("looks 30 days ahead when no income is expected", () => {
    const merged = mergeRecurring(input({ recurringItems: items.filter((i) => i.direction === "outflow") })).items;
    const [p] = upcomingProjections({ accounts: [checking], items: merged, cardPayments: [], today: TODAY });
    expect(p!.nextIncome).toBeNull();
    expect(p!.windowEnd).toBe("2026-12-18");
    expect(p!.events.map((e) => e.recurringItemId)).toEqual(["rent", "phone", "late"]);
    expect(p!.windowReason).toMatch(/30 days/);
  });

  it("edits change the projection (an added item, an edited amount)", () => {
    const [before] = project();
    const [after] = project([], {
      recurringOverrides: [override("rent", { amountCents: 10000 })],
    });
    expect(after!.lowestPoint.cents - before!.lowestPoint.cents).toBe(20000);
  });
});

describe("§9 month calendar", () => {
  it("shows when each charge hits and the month's fixed-cost total", () => {
    const merged = mergeRecurring(
      input({
        recurringItems: [
          recurring({ id: "rent", merchantName: "Rent", predictedNextDate: "2026-12-01", averageAmountCents: 150000, lastAmountCents: 150000 }),
          recurring({ id: "gym", merchantName: "Gym", frequency: "weekly", predictedNextDate: "2026-11-20", averageAmountCents: 1000, lastAmountCents: 1000 }),
          recurring({ id: "pay", direction: "inflow", merchantName: "Pay", predictedNextDate: "2026-11-30", averageAmountCents: 300000, lastAmountCents: 300000 }),
        ],
      }),
    ).items;
    const cal = monthCalendar("2026-11", merged);
    expect(cal.days.map((d) => [d.date, d.entries.map((e) => e.name)])).toEqual([
      ["2026-11-01", ["Rent"]],
      ["2026-11-06", ["Gym"]],
      ["2026-11-13", ["Gym"]],
      ["2026-11-20", ["Gym"]],
      ["2026-11-27", ["Gym"]],
      ["2026-11-30", ["Pay"]],
    ]);
    expect(cal.fixedCostsCents).toBe(150000 + 4 * 1000);
    expect(cal.incomeCents).toBe(300000);
    expect(cal.estimatedCents).toBe(0);
  });
});

describe("§9 credit cards and the account they're paid from", () => {
  it("recurring.cards lists every card with its paying account, even with no statement due", async () => {
    const { queryRegistry } = await import("../../src/queries/index.ts");
    const { basicFixture } = await import("../../fixtures/index.ts");
    const { data, today } = basicFixture();
    data.liabilities = data.liabilities.map((l) => ({ ...l, nextPaymentDueDate: "2026-10-05" }));
    const q = queryRegistry.get("recurring.cards")!;
    const r = q.run(data as never, q.params.parse({}), today) as { value: { cards: Array<Record<string, unknown>> } };
    expect(r.value.cards).toEqual([
      expect.objectContaining({ cardAccountId: "acc_card", payingAccountId: "acc_checking", payingAccountName: "Checking", lastStatementBalanceCents: 20000, nextPaymentDueDate: "2026-10-05" }),
    ]);
    // A card with no liabilities row yet is listed with no paying account.
    data.liabilities = [];
    const none = q.run(data as never, q.params.parse({}), today) as { value: { cards: Array<Record<string, unknown>> } };
    expect(none.value.cards).toEqual([expect.objectContaining({ cardAccountId: "acc_card", payingAccountId: null, payingAccountName: null })]);
  });
});
