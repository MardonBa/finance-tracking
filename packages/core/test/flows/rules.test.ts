/**
 * §6: transfer matching, refunds, splits, Poker, reconciliation, Needs a look.
 */
import { describe, expect, it } from "vitest";
import { flowsFixture } from "../../fixtures/flows.ts";
import { applyMutations, ActionError } from "../../src/registry.ts";
import { actionRegistry } from "../../src/actions/index.ts";
import { queryRegistry } from "../../src/queries/index.ts";
import { buildLedger, type Ledger } from "../../src/flows/ledger.ts";
import { suggestTransferMatches, MATCH_WINDOW_DAYS } from "../../src/flows/transfers.ts";
import { suggestRefundLinks, refundableCents } from "../../src/flows/refunds.ts";
import { needsALook } from "../../src/flows/needsALook.ts";
import { pokerSummary } from "../../src/flows/poker.ts";
import { netWorthEquation, reconcileAccount } from "../../src/flows/reconcile.ts";
import { monthTotals } from "../../src/spending/summary.ts";
import { spendingByCategory } from "../../src/spending/breakdowns.ts";
import { addDays } from "../../src/dates.ts";
import type { CoreData } from "../../src/types.ts";
import { ctx, mini, txn } from "./helpers.ts";

const bucketOf = (l: Ledger, id: string) => l.byTransaction.get(id)?.[0]?.bucket;
const run = (name: string, data: CoreData, input: unknown, c = ctx()) => {
  const a = actionRegistry.get(name)!;
  const parsed = a.input.parse(input);
  const preview = a.describe(data as never, parsed, c);
  const muts = a.apply(data as never, parsed, c);
  return { preview, data: applyMutations(data, muts), muts };
};

describe("transfer matching (§6, decision 005)", () => {
  const pair = (gap: number, outCat: string | null, inCat: string | null) =>
    mini([
      txn("out", "chk", -50000, "2026-10-05", { detailed: outCat }),
      txn("in", "hysa", 50000, addDays("2026-10-05", gap), { detailed: inCat }),
    ]);

  it("matches an equal outflow and inflow across accounts within ~5 days, Plaid's transfer labels first", () => {
    const l = buildLedger(pair(MATCH_WINDOW_DAYS, "TRANSFER_OUT_SAVINGS", "TRANSFER_IN_SAVINGS"));
    expect(l.transferLinks).toHaveLength(1);
    expect(l.transferLinks[0]!.needsReview).toBe(false);
    expect(bucketOf(l, "out")).toBe("transfer");
  });

  it("does not match beyond the window, the same account, or different amounts", () => {
    expect(buildLedger(pair(MATCH_WINDOW_DAYS + 1, "TRANSFER_OUT_SAVINGS", "TRANSFER_IN_SAVINGS")).transferLinks).toHaveLength(0);
    const same = mini([txn("o", "chk", -100, "2026-10-01", { detailed: "TRANSFER_OUT_SAVINGS" }), txn("i", "chk", 100, "2026-10-01", { detailed: "TRANSFER_IN_SAVINGS" })]);
    expect(buildLedger(same).transferLinks).toHaveLength(0);
    const diff = mini([txn("o", "chk", -100, "2026-10-01", { detailed: "TRANSFER_OUT_SAVINGS" }), txn("i", "hysa", 101, "2026-10-01", { detailed: "TRANSFER_IN_SAVINGS" })]);
    expect(buildLedger(diff).transferLinks).toHaveLength(0);
  });

  it("prefers the labelled pair over an amount-only coincidence", () => {
    const d = mini([
      txn("out", "chk", -5000, "2026-10-05", { detailed: "TRANSFER_OUT_SAVINGS" }),
      txn("refund_in", "card", 5000, "2026-10-05", { detailed: "GENERAL_MERCHANDISE_OTHER" }),
      txn("real_in", "hysa", 5000, "2026-10-07", { detailed: "TRANSFER_IN_SAVINGS" }),
    ]);
    const links = suggestTransferMatches(d);
    expect(links.map((x) => x.inTransactionId)).toEqual(["real_in"]);
  });

  it("tricky case: a coincidental match is flagged for review and can be undone", () => {
    const d = mini([
      txn("pay50", "chk", -5000, "2026-10-05", { raw: "ZELLE TO DANA", detailed: "TRANSFER_OUT_ACCOUNT_TRANSFER" }),
      txn("refund50", "card", 5000, "2026-10-06", { merchantName: "REI", detailed: "GENERAL_MERCHANDISE_SPORTING_GOODS" }),
    ]);
    const l = buildLedger(d);
    expect(l.transferLinks).toHaveLength(1);
    expect(l.transferLinks[0]!.needsReview).toBe(true);
    expect(needsALook(l, { from: "2026-10-01", to: "2026-10-31" }).map((i) => i.kind)).toContain("transfer_match_review");

    const { data: after, preview } = run("flows.unmarkTransfer", d, { transactionId: "refund50" });
    expect(preview.changes.find((c) => c.label === "Match")?.before).toBe("Transfer: Checking → Card");
    const l2 = buildLedger(after);
    expect(after.transferLinks).toHaveLength(1);
    expect(after.transferLinks[0]!.undoneAt).not.toBeNull();
    expect(l2.transferLinks).toHaveLength(0);
    // The refund is spending again (a credit); the Zelle payment is an unmatched Plaid transfer → Needs a look.
    expect(bucketOf(l2, "refund50")).toBe("spending");
    expect(bucketOf(l2, "pay50")).toBe("transfer");
    expect(needsALook(l2, { from: "2026-10-01", to: "2026-10-31" }).map((i) => i.kind)).toEqual(["unmatched_transfer"]);
  });

  it("an unmatched Plaid-labelled transfer counts as a transfer and sits in Needs a look until confirmed or covered by a rule", () => {
    const { data } = flowsFixture();
    const l = buildLedger(data);
    expect(bucketOf(l, "zelle_out")).toBe("transfer");
    const items = needsALook(l, { from: "2026-10-01", to: "2026-10-20" });
    expect(items.find((i) => i.kind === "unmatched_transfer")?.transactionIds).toEqual(["zelle_out"]);

    const confirmed = run("flows.confirm", data, { transactionIds: ["zelle_out"] }).data;
    expect(needsALook(buildLedger(confirmed), { from: "2026-10-01", to: "2026-10-20" }).some((i) => i.kind === "unmatched_transfer")).toBe(false);

    const ruled = run("flows.markTransfer", data, { transactionId: "zelle_out", always: { kind: "description_contains", value: "ZELLE TO JORDAN" } }).data;
    expect(ruled.rules.some((r) => r.matchValue === "ZELLE TO JORDAN" && r.setBucket === "transfer")).toBe(true);
    expect(needsALook(buildLedger(ruled), { from: "2026-10-01", to: "2026-10-20" }).some((i) => i.kind === "unmatched_transfer")).toBe(false);
  });

  it("manual pairing checks direction and amount, and shows one 'Transfer: A → B' item", () => {
    const d = mini([txn("o", "chk", -7000, "2026-10-01", { raw: "TO VENMO" }), txn("i", "cash", 7000, "2026-10-20", { raw: "cash" }), txn("x", "cash", 7001, "2026-10-20")]);
    expect(() => run("flows.markTransfer", d, { transactionId: "o", counterpartTransactionId: "x" })).toThrow(ActionError);
    const { data: after, preview } = run("flows.markTransfer", d, { transactionId: "o", counterpartTransactionId: "i" });
    expect(preview.changes.find((c) => c.label === "Matched with")?.after).toBe("Transfer: Checking → Cash");
    const q = queryRegistry.get("flows.transfers")!;
    const r = q.run(after as never, q.params.parse({ from: "2026-10-01", to: "2026-10-31" }), "2026-10-20");
    expect((r.value as { pairs: { label: string; amountCents: number }[] }).pairs).toEqual([
      expect.objectContaining({ label: "Transfer: Checking → Cash", amountCents: 7000 }),
    ]);
  });

  it("a rule that makes a transaction Poker keeps it out of automatic matching", () => {
    const { data } = flowsFixture();
    expect(bucketOf(buildLedger(data), "poker_in")).toBe("poker");
  });
});

describe("refunds (§6)", () => {
  it("auto-suggests by same merchant, amount ≤ purchase, within 90 days", () => {
    const { data } = flowsFixture();
    const s = suggestRefundLinks(buildLedger(data));
    expect(s).toEqual([expect.objectContaining({ refundTransactionId: "amazon_refund_unlinked", purchaseTransactionId: "amazon_oct" })]);
  });

  it("does not suggest after 90 days, for a bigger refund, or for another merchant; never re-suggests an unlinked pair", () => {
    const mk = (refundDate: string, refund: number, merchant = "Amazon") =>
      mini([
        txn("buy", "card", -5000, "2026-06-01", { merchantName: "Amazon", detailed: "GENERAL_MERCHANDISE_OTHER" }),
        txn("ref", "card", refund, refundDate, { merchantName: merchant, detailed: "GENERAL_MERCHANDISE_OTHER" }),
      ]);
    expect(suggestRefundLinks(buildLedger(mk(addDays("2026-06-01", 90), 5000)))).toHaveLength(1);
    expect(suggestRefundLinks(buildLedger(mk(addDays("2026-06-01", 91), 5000)))).toHaveLength(0);
    expect(suggestRefundLinks(buildLedger(mk("2026-06-10", 5001)))).toHaveLength(0);
    expect(suggestRefundLinks(buildLedger(mk("2026-06-10", 5000, "Target")))).toHaveLength(0);
    const undone = [{ refundTransactionId: "ref", purchaseTransactionId: "buy", undoneAt: "x" }];
    expect(suggestRefundLinks(buildLedger(mk("2026-06-10", 5000)), undone)).toHaveLength(0);
  });

  it("tricky case: a refund in a later month counts in the purchase's period and category", () => {
    const { data } = flowsFixture();
    const l = buildLedger(data);
    const e = l.byTransaction.get("amazon_refund")![0]!;
    expect(e.countDate).toBe("2026-09-28");
    expect(e.category).toBe("GENERAL_MERCHANDISE_ONLINE_MARKETPLACES");
    const sep = spendingByCategory(l, "2026-09-01", "2026-09-30");
    expect(sep.figures["category.GENERAL_MERCHANDISE"]!.cents).toBe(6000);
    // Unlinking moves it back to October.
    const unlinked = buildLedger(run("flows.unlinkRefund", data, { refundTransactionId: "amazon_refund" }).data);
    expect(monthTotals(unlinked, "2026-09").spendingCents).toBe(monthTotals(l, "2026-09").spendingCents + 4000);
    expect(monthTotals(unlinked, "2026-10").spendingCents).toBe(monthTotals(l, "2026-10").spendingCents - 4000);
  });

  it("a linked refund can't reduce the purchase below zero (the action refuses; stored excess counts on its own)", () => {
    const d = mini([
      txn("buy", "card", -3000, "2026-10-01", { merchantName: "Shop", detailed: "GENERAL_MERCHANDISE_OTHER" }),
      txn("r1", "card", 2000, "2026-10-05", { merchantName: "Shop", detailed: "GENERAL_MERCHANDISE_OTHER" }),
      txn("r2", "card", 2000, "2026-10-06", { merchantName: "Shop", detailed: "GENERAL_MERCHANDISE_OTHER" }),
    ]);
    const once = run("flows.linkRefund", d, { refundTransactionId: "r1", purchaseTransactionId: "buy" }).data;
    expect(refundableCents(buildLedger(once), "buy")).toBe(1000);
    expect(() => run("flows.linkRefund", once, { refundTransactionId: "r2", purchaseTransactionId: "buy" })).toThrow(/below zero/);
    // Data that slipped past (e.g. the purchase amount changed): the cap still holds.
    const forced = {
      ...once,
      refundLinks: [...once.refundLinks, { id: "rl2", refundTransactionId: "r2", purchaseTransactionId: "buy", source: "manual" as const, undoneAt: null, needsReview: false, createdAt: "x" }],
    };
    const l = buildLedger(forced);
    const linkedToBuy = l.entries.filter((e) => e.refundOfTransactionId === "buy").reduce((s, e) => s + e.amountCents, 0);
    expect(linkedToBuy).toBe(3000);
    const excess = l.byTransaction.get("r2")!.find((e) => e.key === "r2+excess")!;
    expect(excess.amountCents).toBe(1000);
    expect(monthTotals(l, "2026-10").spendingCents).toBe(3000 - 4000);
  });

  it("a refund of a split purchase is spread over its parts", () => {
    const d = mini(
      [
        txn("buy", "card", -10000, "2026-10-01", { merchantName: "Costco", detailed: "GENERAL_MERCHANDISE_SUPERSTORES" }),
        txn("ref", "card", 5000, "2026-11-03", { merchantName: "Costco", detailed: "GENERAL_MERCHANDISE_SUPERSTORES" }),
      ],
      {
        splits: [
          { id: "a", transactionId: "buy", amountCents: -6000, category: "FOOD_AND_DRINK_GROCERIES", necessity: null, note: null, position: 0 },
          { id: "b", transactionId: "buy", amountCents: -4000, category: "HOME_IMPROVEMENT_FURNITURE", necessity: null, note: null, position: 1 },
        ],
        refundLinks: [{ id: "rl", refundTransactionId: "ref", purchaseTransactionId: "buy", source: "manual", undoneAt: null, needsReview: false, createdAt: "x" }],
      },
    );
    const l = buildLedger(d);
    const parts = l.byTransaction.get("ref")!;
    expect(parts.map((p) => [p.category, p.amountCents, p.countDate])).toEqual([
      ["FOOD_AND_DRINK_GROCERIES", 3000, "2026-10-01"],
      ["HOME_IMPROVEMENT_FURNITURE", 2000, "2026-10-01"],
    ]);
    expect(monthTotals(l, "2026-10").spendingCents).toBe(5000);
  });
});

describe("splits (§6)", () => {
  it("tricky case: split parts count in their own categories and add up to the original", () => {
    const { data } = flowsFixture();
    const l = buildLedger(data);
    const parts = l.byTransaction.get("costco_split")!;
    expect(parts.map((p) => [p.category, p.amountCents])).toEqual([
      ["FOOD_AND_DRINK_GROCERIES", -9000],
      ["HOME_IMPROVEMENT_FURNITURE", -6000],
    ]);
  });

  it("the split action refuses parts that don't add up, and unsplit restores one entry", () => {
    const { data } = flowsFixture();
    expect(() => run("transactions.split", data, { transactionId: "groc_10", parts: [{ amountCents: -1000 }, { amountCents: -1000 }] })).toThrow(/add up/);
    const ok = run("transactions.split", data, { transactionId: "groc_10", parts: [{ amountCents: -15000 }, { amountCents: -6000, category: "PERSONAL_CARE" }] });
    expect(buildLedger(ok.data).byTransaction.get("groc_10")!.map((e) => e.category)).toEqual(["FOOD_AND_DRINK_GROCERIES", "PERSONAL_CARE"]);
    const un = run("transactions.unsplit", ok.data, { transactionId: "groc_10" }).data;
    expect(buildLedger(un).byTransaction.get("groc_10")).toHaveLength(1);
  });

  it("stored splits that no longer add up are counted unsplit and flagged", () => {
    const d = mini([txn("t", "card", -1000, "2026-10-02", { detailed: "GENERAL_MERCHANDISE_OTHER" })], {
      splits: [{ id: "s", transactionId: "t", amountCents: -400, category: null, necessity: null, note: null, position: 0 }],
    });
    const l = buildLedger(d);
    expect(l.byTransaction.get("t")).toHaveLength(1);
    expect(needsALook(l, { from: "2026-10-01", to: "2026-10-31" }).map((i) => i.kind)).toContain("split_mismatch");
  });
});

describe("Poker (§6)", () => {
  it("Poker rules by payer/payee keep individual Poker money out of spending and income", () => {
    const { data } = flowsFixture();
    const l = buildLedger(data);
    expect(bucketOf(l, "poker_in")).toBe("poker");
    expect(bucketOf(l, "poker_out")).toBe("poker");
    const income = l.entries.filter((e) => e.bucket === "income").map((e) => e.transactionId);
    expect(income).not.toContain("poker_in");
  });

  it("the Poker summary shows in, out and net; the net is one income line and can be negative", () => {
    const { data } = flowsFixture();
    const l = buildLedger(data);
    const s = pokerSummary(l, "2026-10-01", "2026-10-31");
    expect(s.value).toMatchObject({ inCents: 20000, outCents: 25000, netCents: -5000, count: 2 });
    const q = queryRegistry.get("flows.income")!;
    const r = q.run(data as never, q.params.parse({ from: "2026-10-01", to: "2026-10-31" }), "2026-10-20").value as { lines: { key: string; cents: number }[] };
    expect(r.lines.find((x) => x.key === "poker")?.cents).toBe(-5000);
  });

  it("mark Poker with a rule, and unmark it", () => {
    const d = mini([txn("v", "chk", 4000, "2026-10-02", { raw: "VENMO FROM CHRIS", detailed: "TRANSFER_IN_ACCOUNT_TRANSFER" }), txn("v2", "chk", 1000, "2026-10-09", { raw: "VENMO FROM CHRIS", detailed: "TRANSFER_IN_ACCOUNT_TRANSFER" })]);
    const marked = run("flows.markPoker", d, { transactionId: "v", poker: true, always: { kind: "description_contains" } }).data;
    expect(bucketOf(buildLedger(marked), "v2")).toBe("poker");
    const un = run("flows.markPoker", marked, { transactionId: "v2", poker: false }).data;
    expect(bucketOf(buildLedger(un), "v2")).toBe("spending");
    expect(bucketOf(buildLedger(un), "v")).toBe("poker");
  });
});

describe("the numbers add up (§6)", () => {
  const { data } = flowsFixture();
  const l = buildLedger(data);

  it("per account: start + in − out = end; a difference is shown as unexplained", () => {
    const chk = reconcileAccount(l, data.balanceSnapshots, "chk", "2026-10-01", "2026-10-20").value;
    expect(chk.status).toBe("unexplained");
    expect(chk.unexplainedCents).toBe(1234);
    expect(chk.expectedEndCents! + 1234).toBe(chk.endBalanceCents);
    const hysa = reconcileAccount(l, data.balanceSnapshots, "hysa", "2026-10-01", "2026-10-20").value;
    expect(hysa).toMatchObject({ status: "ok", unexplainedCents: 0 });
    const brok = reconcileAccount(l, data.balanceSnapshots, "brok", "2026-10-01", "2026-10-20").value;
    expect(brok).toMatchObject({ status: "ok", isInvestment: true, marketChangeCents: 7777, unexplainedCents: 0 });
    expect(reconcileAccount(l, data.balanceSnapshots, "cash", "2026-10-01", "2026-10-20").value.status).toBe("missing_snapshot");
  });

  it("across everything: income − spending ± transfers ± investment change = change in net worth, leftover shown", () => {
    const eq = netWorthEquation(l, data.balanceSnapshots, "2026-10-01", "2026-10-20").value;
    expect(eq.leftoverCents).toBe(1234);
    expect(eq.missingSnapshotAccountIds).toEqual(["cash"]);
    expect(eq.investmentChangeCents).toBe(7777);
    expect(eq.changeCents).toBe(
      eq.incomeCents - eq.spendingCents + eq.pokerNetCents + eq.transfersNetCents + eq.investmentChangeCents + eq.leftoverCents,
    );
    // Matched transfers inside the linked set cancel: what's left is money to accounts without snapshots / not linked
    // (ATM → cash $60, Zelle $30, the brokerage buy $1,000 inside the brokerage).
    expect(eq.transfersNetCents).toBe(-6000 - 3000 - 100000);
  });
});

describe("Needs a look (§6)", () => {
  const { data } = flowsFixture();
  const items = needsALook(buildLedger(data), { from: "2026-10-01", to: "2026-10-20" });
  const kinds = (k: string) => items.filter((i) => i.kind === k).map((i) => i.transactionIds);

  it("holds only what the app is unsure about", () => {
    expect(kinds("unmatched_transfer")).toEqual([["zelle_out"]]);
    expect(kinds("uncategorised")).toEqual([["cash_market"]]);
    expect(kinds("possible_duplicate")).toEqual([["netflix_a", "netflix_b"]]);
    expect(kinds("large_unusual")).toEqual([["tv_big"]]);
    expect(items).toHaveLength(4);
  });

  it("each item carries merchant, category and amount", () => {
    for (const i of items) {
      expect(i.merchantName.length).toBeGreaterThan(0);
      expect(i.category.length).toBeGreaterThan(0);
      expect(typeof i.amountCents).toBe("number");
    }
  });

  it("large unusual compares with the category's history", () => {
    const hist = [1, 2, 3, 4].map((i) => txn(`h${i}`, "card", -2000, `2026-09-0${i}`, { merchantName: `Shop${i}`, detailed: "GENERAL_MERCHANDISE_OTHER" }));
    const d = mini([...hist, txn("big", "card", -12000, "2026-10-02", { merchantName: "Shop9", detailed: "GENERAL_MERCHANDISE_OTHER" }), txn("ok", "card", -5000, "2026-10-03", { merchantName: "Shop8", detailed: "GENERAL_MERCHANDISE_OTHER" })]);
    const big = needsALook(buildLedger(d), { from: "2026-10-01", to: "2026-10-31" }).filter((i) => i.kind === "large_unusual");
    expect(big.map((i) => i.transactionIds[0])).toEqual(["big"]);
    expect(big[0]!.reason).toMatch(/6\.0× your usual/);
  });

  it("a repeated big charge (rent) is not unusual", () => {
    const d = mini([txn("r1", "chk", -150000, "2026-09-03", { merchantName: "Landlord", detailed: "RENT_AND_UTILITIES_RENT" }), txn("r2", "chk", -150000, "2026-10-03", { merchantName: "Landlord", detailed: "RENT_AND_UTILITIES_RENT" })]);
    expect(needsALook(buildLedger(d), { from: "2026-10-01", to: "2026-10-31" })).toEqual([]);
  });
});
