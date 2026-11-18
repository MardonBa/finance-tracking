/**
 * The core-balances queries and actions, run through the registry against
 * the basic fixture plus goals, recurring items and snapshots.
 */
import { describe, expect, it } from "vitest";
import { basicFixture } from "../../fixtures/index.ts";
import { ActionError, applyMutations, findRow, inverseMutations, type ActionContext, type AnyAction } from "../../src/registry.ts";
import { actionRegistry } from "../../src/actions/index.ts";
import { queryRegistry } from "../../src/queries/index.ts";
import type { CoreData } from "../../src/types.ts";
import { eachDay } from "../../src/dates.ts";
import { goal, recurring, snap, tx } from "./builders.ts";

function ctx(): ActionContext {
  let n = 0;
  return { today: "2026-10-31", now: "2026-10-31T12:00:00.000Z", newId: () => `new_${++n}` };
}

function rich(): { data: CoreData; today: string } {
  const { data, today } = basicFixture();
  data.goals = [
    goal({ id: "g_bike", name: "Bike", targetCents: 120000, priority: 1, colorSlot: 0 }),
    goal({ id: "g_mac", name: "MacBook", targetCents: 250000, priority: 2, colorSlot: 1, deadline: "2027-06-01" }),
    goal({ id: "g_trip", name: "Trip", targetCents: 300000, priority: 3, colorSlot: 2, expectedContributionCents: 30000, contributionPeriod: "monthly" }),
  ];
  // HYSA: 1,051,234 now, protected 500,000 → 551,234 for goals.
  data.balanceSnapshots.push(...eachDay("2026-08-01", "2026-10-30").map((d, i) => snap("acc_hysa", d, 900000 + i * 1600)));
  data.recurringItems = [
    recurring({ id: "r_rent", merchantName: "Rent", predictedNextDate: "2026-11-01", averageAmountCents: 300000, lastAmountCents: 300000 }),
    recurring({ id: "r_auto", merchantName: "Streaming", predictedNextDate: "2026-11-10", averageAmountCents: 1500, lastAmountCents: 1500 }),
    recurring({ id: "r_pay", direction: "inflow", merchantName: "Acme", predictedNextDate: "2026-11-15", averageAmountCents: 250000, lastAmountCents: 250000 }),
    recurring({ id: "r_mine", source: "manual", plaidStreamId: null, merchantName: null, description: "Gym", predictedNextDate: "2026-11-05", averageAmountCents: 4500, lastAmountCents: null }),
  ];
  data.recurringItemTransactions = [{ recurringItemId: "r_pay", transactionId: "tx_paycheck" }];
  return { data, today };
}

function run(name: string, data: CoreData, input: unknown) {
  const a = actionRegistry.get(name) as AnyAction;
  const parsed = a.input.parse(input);
  const slices = Object.fromEntries(a.needs.map((k: keyof CoreData) => [k, data[k]])) as Partial<CoreData>;
  const preview = a.describe(slices as never, parsed, ctx());
  const muts = a.apply(slices as never, parsed, ctx());
  const after = applyMutations(data, muts);
  const restored = applyMutations(after, a.inverse ? a.inverse(slices as never, parsed, muts) : inverseMutations(slices, muts));
  for (const k of a.needs as (keyof CoreData)[]) {
    const s = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).sort();
    expect(s(restored[k] as unknown[]), `${name} inverse ${k}`).toEqual(s(data[k] as unknown[]));
  }
  return { preview, muts, after };
}

function query(name: string, data: CoreData, params: unknown, today: string) {
  const q = queryRegistry.get(name)!;
  return q.run(data as never, q.params.parse(params), today) as { value: any; figures: Record<string, { cents: number; contributions: { cents: number }[] }> };
}

describe("registered names", () => {
  it("has a query for each view and the requested actions", () => {
    const names = [...queryRegistry.names(), ...actionRegistry.names()];
    for (const n of [
      "balances.netWorth",
      "balances.netWorthChart",
      "balances.accountHistory",
      "accounts.list",
      "goals.list",
      "goals.accountBars",
      "goals.celebrations",
      "goals.whatIf",
      "goals.explainChanges",
      "recurring.list",
      "recurring.upcoming",
      "recurring.calendar",
      "trajectory.earningVsSpending",
      "trajectory.investmentGrowth",
      "trajectory.interest",
      "trajectory.assumptions",
      "trajectory.projection",
      "investments.holdings",
      "investments.allocation",
      "investments.performance",
      "investments.activity",
      "investments.history",
      "goals.create",
      "goals.edit",
      "goals.delete",
      "goals.reorder",
      "goals.archive",
      "goals.linkPurchase",
      "goals.setDeadline",
      "goals.setContribution",
      "accounts.setProtectedAmount",
      "recurring.add",
      "recurring.edit",
      "recurring.remove",
      "trajectory.setAssumptions",
      "trajectory.addLifePhase",
      "trajectory.editLifePhase",
      "trajectory.removeLifePhase",
      "accounts.rename",
      "accounts.setHidden",
      "accounts.retype",
      "accounts.addManualAccount",
      "accounts.setStartingBalance",
      "accounts.addManualTransaction",
      "accounts.editManualTransaction",
      "accounts.deleteManualTransaction",
    ]) {
      expect(names, n).toContain(n);
    }
  });
});

describe("goal actions", () => {
  it("create appends at the lowest priority, or inserts and shifts others; describe shows money moving", () => {
    const { data } = rich();
    const last = run("goals.create", data, { name: "Car", accountId: "acc_hysa", targetCents: 50000 });
    expect(findRow(last.after, "goals", { id: "new_1" })).toMatchObject({ priority: 4, colorSlot: 3 });
    const first = run("goals.create", data, { name: "Car", accountId: "acc_hysa", targetCents: 50000, priority: 1 });
    expect(first.after.goals.map((g) => [g.id, g.priority]).sort()).toEqual([
      ["g_bike", 2],
      ["g_mac", 3],
      ["g_trip", 4],
      ["new_1", 1],
    ]);
    expect(first.preview.changes).toContainEqual({ label: "Trip (money assigned)", before: "$1,812.34", after: "$1,312.34" });
    expect(() => run("goals.create", data, { name: "X", accountId: "acc_card", targetCents: 1 })).toThrow(ActionError);
  });

  it("edit, delete, set deadline, set contribution, link purchase", () => {
    const { data } = rich();
    expect(findRow(run("goals.edit", data, { goalId: "g_mac", targetCents: 200000, name: "Laptop" }).after, "goals", { id: "g_mac" })).toMatchObject({ targetCents: 200000, name: "Laptop" });
    const del = run("goals.delete", { ...data, goalMilestonesSeen: [{ goalId: "g_bike", milestoneCents: 30000, seenAt: "" }] }, { goalId: "g_bike" });
    expect(del.after.goals.map((g) => [g.id, g.priority])).toEqual(expect.arrayContaining([["g_mac", 1], ["g_trip", 2]]));
    expect(del.after.goalMilestonesSeen).toEqual([]);
    expect(findRow(run("goals.setDeadline", data, { goalId: "g_bike", deadline: "2027-01-01" }).after, "goals", { id: "g_bike" })!.deadline).toBe("2027-01-01");
    const c = run("goals.setContribution", data, { goalId: "g_bike", expectedContributionCents: 20000, contributionPeriod: "weekly" });
    expect(findRow(c.after, "goals", { id: "g_bike" })).toMatchObject({ expectedContributionCents: 20000, contributionPeriod: "weekly" });
    expect(c.preview.changes[0]).toEqual({ label: "Expected contribution", before: null, after: "$200.00 weekly" });
    const link = run("goals.linkPurchase", data, { goalId: "g_bike", transactionId: "tx_card_purchase_amazon" });
    expect(findRow(link.after, "goals", { id: "g_bike" })!.purchaseTransactionId).toBe("tx_card_purchase_amazon");
    expect(() => run("goals.linkPurchase", data, { goalId: "g_bike", transactionId: "nope" })).toThrow(ActionError);
  });

  it("reorder sets priorities, explains who loses, and refuses incomplete orders", () => {
    const { data } = rich();
    const r = run("goals.reorder", data, { accountId: "acc_hysa", goalIds: ["g_trip", "g_bike", "g_mac"] });
    expect(r.after.goals.map((g) => [g.id, g.priority]).sort()).toEqual([
      ["g_bike", 2],
      ["g_mac", 3],
      ["g_trip", 1],
    ]);
    expect(r.preview.changes[0]).toEqual({ label: "Order", before: "Bike → MacBook → Trip", after: "Trip → Bike → MacBook" });
    expect(r.preview.changes).toContainEqual({ label: "MacBook (money assigned)", before: "$2,500.00", after: "$1,312.34" });
    expect(() => run("goals.reorder", data, { accountId: "acc_hysa", goalIds: ["g_trip"] })).toThrow(ActionError);
  });

  it("archive keeps it as an achievement; milestones are recorded once", () => {
    const { data } = rich();
    const a = run("goals.archive", data, { goalId: "g_bike", archived: true });
    expect(findRow(a.after, "goals", { id: "g_bike" })).toMatchObject({ archivedAt: "2026-10-31T12:00:00.000Z", completedAt: "2026-10-31T12:00:00.000Z" });
    const m = run("goals.markMilestonesSeen", { ...data, goalMilestonesSeen: [{ goalId: "g_bike", milestoneCents: 30000, seenAt: "x" }] }, { goalId: "g_bike", milestonesCents: [30000, 60000] });
    expect(m.muts).toHaveLength(1);
    expect(run("goals.markComplete", data, { goalId: "g_bike", completed: true }).after.goals.find((g) => g.id === "g_bike")!.completedAt).not.toBeNull();
  });
});

describe("account actions", () => {
  it("protected amount: describe shows goals losing money", () => {
    const { data } = rich();
    const r = run("accounts.setProtectedAmount", data, { accountId: "acc_hysa", protectedAmountCents: 900000 });
    expect(findRow(r.after, "accounts", { id: "acc_hysa" })!.protectedAmountCents).toBe(900000);
    expect(r.preview.changes).toContainEqual({ label: "Trip (money assigned)", before: "$1,812.34", after: "$0.00" });
  });

  it("rename, hide, retype", () => {
    const { data } = rich();
    expect(run("accounts.rename", data, { accountId: "acc_card", nickname: "Visa" }).preview.changes).toEqual([{ label: "Name", before: "Plaid Credit Card", after: "Visa" }]);
    expect(findRow(run("accounts.setHidden", data, { accountId: "acc_card", hidden: true }).after, "accounts", { id: "acc_card" })!.hidden).toBe(true);
    expect(run("accounts.retype", data, { accountId: "acc_hysa", kind: "checking" }).preview.changes).toEqual([{ label: "Type", before: "savings", after: "checking" }]);
  });

  it("manual accounts: starting balance and transactions; the balance is derived from transactions", () => {
    const { data } = rich();
    const created = run("accounts.addManualAccount", data, { name: "Wallet", startingBalanceCents: 4000, startingDate: "2026-10-01" });
    const acc = findRow(created.after, "accounts", { id: "new_1" })!;
    expect(acc).toMatchObject({ isManual: true, kindOverride: "cash", currentBalanceCents: 4000, connectedOn: "2026-10-01" });
    expect(findRow(created.after, "transactions", { id: "new_1__opening" })).toMatchObject({ amountCents: 4000, isManual: true });
    expect(findRow(created.after, "overrides", { transactionId: "new_1__opening" })).toMatchObject({ bucket: "transfer" });

    const added = run("accounts.addManualTransaction", created.after, { accountId: "new_1", amountCents: -1500, date: "2026-10-10", description: "Lunch" });
    expect(findRow(added.after, "accounts", { id: "new_1" })!.currentBalanceCents).toBe(2500);
    const txId = added.after.transactions.find((t) => t.rawDescription === "Lunch")!.id;
    const edited = run("accounts.editManualTransaction", added.after, { transactionId: txId, amountCents: -2000 });
    expect(findRow(edited.after, "accounts", { id: "new_1" })!.currentBalanceCents).toBe(2000);
    const start = run("accounts.setStartingBalance", edited.after, { accountId: "new_1", startingBalanceCents: 10000 });
    expect(findRow(start.after, "accounts", { id: "new_1" })!.currentBalanceCents).toBe(8000);
    const zero = run("accounts.setStartingBalance", edited.after, { accountId: "new_1", startingBalanceCents: 0 });
    expect(findRow(zero.after, "transactions", { id: "new_1__opening" })).toBeUndefined();
    expect(findRow(zero.after, "accounts", { id: "new_1" })!.currentBalanceCents).toBe(-2000);
    const deleted = run("accounts.deleteManualTransaction", edited.after, { transactionId: txId });
    expect(findRow(deleted.after, "accounts", { id: "new_1" })!.currentBalanceCents).toBe(4000);
  });

  it("deleting a manual transaction removes its links; bank accounts can't be edited by hand", () => {
    const { data } = rich();
    const r = run("accounts.deleteManualTransaction", data, { transactionId: "tx_cash_in" });
    expect(findRow(r.after, "transferLinks", { id: "tl_atm" })).toBeUndefined();
    expect(findRow(r.after, "accounts", { id: "acc_cash" })!.currentBalanceCents).toBe(0);
    expect(() => run("accounts.addManualTransaction", data, { accountId: "acc_checking", amountCents: 1, date: "2026-10-01", description: "x" })).toThrow(ActionError);
    expect(() => run("accounts.deleteManualAccount", { ...data, goals: [goal({ id: "g", accountId: "acc_cash", targetCents: 1, priority: 1 })] }, { accountId: "acc_cash" })).toThrow(/goals/);
  });
});

describe("recurring actions", () => {
  it("add, edit (Plaid item → override; mine → in place), remove and restore", () => {
    const { data, today } = rich();
    const added = run("recurring.add", data, { accountId: "acc_checking", name: "Spotify", amountCents: 1199, frequency: "monthly", nextDate: "2026-11-20" });
    expect(findRow(added.after, "recurringItems", { id: "new_1" })).toMatchObject({ source: "manual", averageAmountCents: 1199, direction: "outflow" });

    const e1 = run("recurring.edit", data, { recurringItemId: "r_auto", amountCents: 1799, accountId: "acc_hysa" });
    expect(findRow(e1.after, "recurringOverrides", { recurringItemId: "r_auto" })).toMatchObject({ amountCents: 1799, accountId: "acc_hysa", name: null });
    expect(e1.preview.changes).toEqual([
      { label: "Amount", before: "$15.00", after: "$17.99" },
      { label: "Account", before: "Checking", after: "HYSA" },
    ]);
    const e2 = run("recurring.edit", data, { recurringItemId: "r_mine", amountCents: 5000, name: "Climbing gym" });
    expect(findRow(e2.after, "recurringItems", { id: "r_mine" })).toMatchObject({ averageAmountCents: 5000, description: "Climbing gym" });

    const rm = run("recurring.remove", data, { recurringItemId: "r_auto" });
    expect(findRow(rm.after, "recurringOverrides", { recurringItemId: "r_auto" })!.removed).toBe(true);
    const listed = query("recurring.list", rm.after, {}, today).value;
    expect(listed.removed).toEqual([{ id: "r_auto", name: "Streaming" }]);
    const restored = run("recurring.remove", rm.after, { recurringItemId: "r_auto", removed: false });
    expect(query("recurring.list", restored.after, {}, today).value.items.map((i: { id: string }) => i.id)).toContain("r_auto");
    const rmMine = run("recurring.remove", data, { recurringItemId: "r_mine" });
    expect(findRow(rmMine.after, "recurringItems", { id: "r_mine" })).toBeUndefined();
  });

  it("an edit updates the upcoming projection", () => {
    const { data, today } = rich();
    const before = query("recurring.upcoming", data, {}, today).value.projections[0];
    const edited = run("recurring.edit", data, { recurringItemId: "r_auto", amountCents: 101500 }).after;
    const after = query("recurring.upcoming", edited, {}, today).value.projections[0];
    expect(after.lowestPoint.cents).toBe(before.lowestPoint.cents - 100000);
  });

  it("choosing the paying account for a card", () => {
    const { data } = rich();
    const r = run("recurring.setCardPayingAccount", data, { cardAccountId: "acc_card", payingAccountId: "acc_hysa" });
    expect(r.preview.changes).toEqual([{ label: "Paid from", before: "Checking", after: "HYSA" }]);
    expect(() => run("recurring.setCardPayingAccount", data, { cardAccountId: "acc_checking", payingAccountId: null })).toThrow(ActionError);
  });
});

describe("trajectory actions", () => {
  it("set assumptions merges into the stored doc; phases are added, edited, removed and never overlap", () => {
    const { data, today } = rich();
    const s = run("trajectory.setAssumptions", data, { investmentReturnPct: 6 });
    expect(s.preview.changes).toEqual([{ label: "Investment return", before: "7%", after: "6%" }]);
    expect(query("trajectory.assumptions", s.after, {}, today).value.assumptions.investmentReturnPct).toBe(6);
    const s2 = run("trajectory.setAssumptions", s.after, { inflationPct: 2 });
    expect(query("trajectory.assumptions", s2.after, {}, today).value.assumptions).toMatchObject({ investmentReturnPct: 6, inflationPct: 2 });

    const add = run("trajectory.addLifePhase", data, { name: "Grad school", fromYear: 2027, toYear: 2028, monthlyIncomeCents: 200000, contributions: [{ accountId: "acc_brokerage", monthlyCents: 0 }] });
    const phase = add.after.lifePhases[0]!;
    expect(phase).toMatchObject({ id: "new_1", fromYear: 2027, monthlyIncomeCents: 200000, savingsRatePct: null });
    expect(JSON.parse(phase.contributionsJson!)).toEqual([{ accountId: "acc_brokerage", monthlyCents: 0 }]);
    expect(() => run("trajectory.addLifePhase", add.after, { name: "Overlap", fromYear: 2028, toYear: 2030 })).toThrow(/overlap/);
    expect(() => run("trajectory.addLifePhase", data, { name: "Backwards", fromYear: 2030, toYear: 2028 })).toThrow();

    const edit = run("trajectory.editLifePhase", add.after, { phaseId: "new_1", toYear: 2029, monthlyIncomeCents: null });
    expect(edit.after.lifePhases[0]).toMatchObject({ toYear: 2029, monthlyIncomeCents: null });
    expect(run("trajectory.removeLifePhase", add.after, { phaseId: "new_1" }).after.lifePhases).toEqual([]);

    // The projection uses the stored phase.
    const proj = query("trajectory.projection", add.after, { horizonYears: 20 }, today).value;
    expect(proj.years.find((y: { year: number }) => y.year === 2027).label).toBe("Grad school");
  });
});

describe("queries on the fixture", () => {
  it("goals.list: cards with allocation, deadline, contributions, projection and celebrations", () => {
    const { data, today } = rich();
    const { goals } = query("goals.list", data, {}, today).value;
    expect(goals.map((g: { goalId: string; savedCents: number }) => [g.goalId, g.savedCents])).toEqual([
      ["g_bike", 120000],
      ["g_mac", 250000],
      ["g_trip", 181234],
    ]);
    const trip = goals.find((g: { goalId: string }) => g.goalId === "g_trip");
    expect(trip.contributions[0]).toMatchObject({ start: "2026-10-01", isCurrent: true });
    expect(trip.projection.projectedDate).not.toBeNull();
    expect(trip.newCelebrations.map((m: { cents: number }) => m.cents)).toEqual([30000, 60000, 90000, 120000, 150000, 180000]);
    const mac = goals.find((g: { goalId: string }) => g.goalId === "g_mac");
    expect(mac.deadline.remainingCents).toBe(0);
    const bars = query("goals.accountBars", data, {}, today).value.accounts[0];
    expect(bars.segments.map((s: { kind: string; cents: number }) => [s.kind, s.cents])).toEqual([
      ["protected", 500000],
      ["goal", 120000],
      ["goal", 250000],
      ["goal", 181234],
      ["unassigned", 0],
    ]);
  });

  it("goals.explainChanges points at the withdrawals and goals.whatIf moves dates", () => {
    const { data, today } = rich();
    data.transactions.push(tx("acc_hysa", "2026-10-20", -200000, { id: "tx_hysa_out" }));
    const r = query("goals.explainChanges", data, { accountId: "acc_hysa", since: "2026-10-01" }, today);
    expect(r.figures.withdrawals!.cents).toBe(-200000);
    const w = query("goals.whatIf", data, { accountId: "acc_hysa", contributionDeltaCents: 100000 }, today).value;
    expect(w.result.shiftDays.g_trip).toBeLessThan(0);
  });

  it("trajectory.interest has drill-down figures for HYSA interest", () => {
    const { data, today } = rich();
    const r = query("trajectory.interest", data, { accountId: "acc_hysa" }, today);
    expect(r.figures["interest.acc_hysa.2026-10"]).toEqual({ cents: 4123, contributions: [{ transactionId: "tx_interest_hysa", cents: 4123 }], label: "HYSA interest · 2026-10" });
    expect(r.value.accounts[0].principalCents + r.value.accounts[0].totalInterestCents).toBe(1051234);
  });

  it("accounts.list derives the manual balance from its transactions, with a drill-down figure", () => {
    const { data, today } = rich();
    const r = query("accounts.list", data, {}, today);
    expect(r.figures["balance.acc_cash"]).toEqual({ cents: 6000, contributions: [{ transactionId: "tx_cash_in", cents: 6000 }], label: "Cash transactions" });
  });

  it("balances.netWorth falls back to live balances before today's sync", () => {
    const { data, today } = rich();
    const r = query("balances.netWorth", data, {}, today).value;
    expect(r.live).toBe(true);
    expect(r.totalCents).toBe(352310 + 1051234 - 18999 + 2104500 + 6000);
  });

  it("recurring.upcoming: paycheck is next income; the card statement is already paid", () => {
    const { data, today } = rich();
    const r = query("recurring.upcoming", data, {}, today).value;
    const chk = r.projections.find((p: { accountId: string }) => p.accountId === "acc_checking");
    expect(chk.nextIncome.date).toBe("2026-11-15");
    expect(chk.events.map((e: { name: string }) => e.name)).toEqual(["Rent", "Gym", "Streaming", "Acme"]);
    expect(chk.lowestPoint.cents).toBe(352310 - 300000 - 4500 - 1500);
    expect(r.warnings).toEqual([]);
    expect(r.cardPayments).toEqual([]);
    expect(query("recurring.list", data, {}, today).figures["occurrences.r_pay"]!.cents).toBe(250000);
  });
});
