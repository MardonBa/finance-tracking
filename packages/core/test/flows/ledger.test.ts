/**
 * §6 transaction rules and §1 money-math invariants on the ledger.
 */
import { describe, expect, it } from "vitest";
import { basicFixture } from "../../fixtures/index.ts";
import { flowsFixture } from "../../fixtures/flows.ts";
import { buildLedger, countable, spendCents, type Ledger } from "../../src/flows/ledger.ts";
import { normalizeMerchantKey } from "../../src/flows/merchants.ts";
import { effectiveDate } from "../../src/flows/dates.ts";
import { inPeriod } from "../../src/flows/figures.ts";
import { savedByDestination, spendingByCategory } from "../../src/spending/breakdowns.ts";
import { actionRegistry } from "../../src/actions/index.ts";
import { applyMutations } from "../../src/registry.ts";
import { monthTotals } from "../../src/spending/summary.ts";
import { isoDateInTimeZone, monthOf } from "../../src/dates.ts";
import { BUCKETS } from "../../src/types.ts";
import { Money } from "../../src/money.ts";
import { mini, txn } from "./helpers.ts";

const bucketOf = (l: Ledger, id: string) => l.byTransaction.get(id)?.[0]?.bucket;
const reasonOf = (l: Ledger, id: string) => l.byTransaction.get(id)?.[0]?.bucketReason;

function invariants(name: string, ledger: Ledger, data: { transactions: { id: string; amountCents: number; removed: boolean }[] }) {
  describe(`invariants: ${name}`, () => {
    it("every transaction lands in exactly one bucket, and its entries add up to its amount", () => {
      for (const t of data.transactions) {
        const entries = ledger.byTransaction.get(t.id) ?? [];
        if (t.removed) {
          expect(entries, t.id).toHaveLength(0);
          continue;
        }
        expect(entries.length, t.id).toBeGreaterThan(0);
        expect(new Set(entries.map((e) => e.bucket)).size, t.id).toBe(1);
        expect(BUCKETS, t.id).toContain(entries[0]!.bucket);
        expect(Money.sum(entries.map((e) => e.amountCents)), t.id).toBe(t.amountCents);
      }
    });

    it("matched transfers net to zero", () => {
      for (const link of ledger.transferLinks) {
        const out = ledger.transactions.get(link.outTransactionId)!;
        const inn = ledger.transactions.get(link.inTransactionId)!;
        expect(out.amountCents + inn.amountCents, link.id).toBe(0);
        expect(bucketOf(ledger, out.id)).toBe("transfer");
        expect(bucketOf(ledger, inn.id)).toBe("transfer");
      }
    });

    it("category totals add up to total spending, every month", () => {
      const months = [...new Set(ledger.entries.map((e) => monthOf(e.countDate)))];
      for (const m of months) {
        const r = spendingByCategory(ledger, `${m}-01`, `${m}-${m.endsWith("02") ? "28" : "30"}`);
        expect(Money.sum(r.value.categories.map((c) => c.cents)), m).toBe(r.value.totalCents);
        const d = spendingByCategory(ledger, `${m}-01`, `${m}-28`, "detailed");
        expect(Money.sum(d.value.categories.map((c) => c.cents)), m).toBe(d.value.totalCents);
      }
    });

    it("splits add up to the original amount", () => {
      for (const [id, entries] of ledger.byTransaction) {
        if (!entries.some((e) => e.splitId)) continue;
        expect(Money.sum(entries.map((e) => e.amountCents))).toBe(ledger.transactions.get(id)!.amountCents);
      }
    });

    it("pending transactions never count", () => {
      for (const e of ledger.entries) expect(countable(e)).toBe(!e.pending);
    });
  });
}

{
  const { data } = flowsFixture();
  invariants("flows fixture", buildLedger(data), data);
}
{
  const { data } = basicFixture();
  invariants("basic fixture", buildLedger(data), data);
}

describe("moving my own money is never spending or income (§6)", () => {
  const { data } = flowsFixture();
  const l = buildLedger(data);

  it("a card purchase counts once; paying the card is a transfer (both halves matched)", () => {
    expect(bucketOf(l, "groc_10")).toBe("spending");
    expect(bucketOf(l, "cardpay_out_09")).toBe("transfer");
    expect(bucketOf(l, "cardpay_in_09")).toBe("transfer");
    expect(l.byTransaction.get("cardpay_out_09")![0]!.transferCounterpartId).toBe("cardpay_in_09");
  });

  it("checking → HYSA and checking → brokerage are transfers; buys inside the brokerage are neither", () => {
    expect(bucketOf(l, "hysa_out_10")).toBe("transfer");
    expect(bucketOf(l, "hysa_in_10")).toBe("transfer");
    expect(bucketOf(l, "brok_out")).toBe("transfer");
    expect(bucketOf(l, "brok_in")).toBe("transfer");
    expect(bucketOf(l, "brok_buy")).toBe("transfer");
    expect(reasonOf(l, "brok_buy")).toBe("investment_account");
    // An investment-transaction buy is not in the ledger at all.
    expect(l.byTransaction.has("itx_buy")).toBe(false);
  });

  it("an ATM withdrawal into the cash account is a transfer", () => {
    expect(bucketOf(l, "atm_out")).toBe("transfer");
    expect(bucketOf(l, "cash_in")).toBe("transfer");
  });

  it("a manual account's opening balance (accounts.addManualAccount) is a transfer: never income, spending, matched or saved", () => {
    const add = actionRegistry.get("accounts.addManualAccount")!;
    const c = { today: "2026-10-20", now: "2026-10-20T12:00:00.000Z", newId: () => "wallet" };
    // An equal outflow on another account the same day must not pair with it.
    const base = mini([txn("out", "chk", -40000, "2026-10-20", { detailed: "TRANSFER_OUT_SAVINGS" })]);
    const input = add.input.parse({ name: "Wallet", kind: "savings", startingBalanceCents: 40000 });
    const after = applyMutations(base, add.apply(base as never, input, c));
    const opening = after.transactions.find((t) => t.id.endsWith("__opening"))!;
    expect(opening.id).toBe("wallet__opening");
    const l2 = buildLedger(after);
    expect(bucketOf(l2, opening.id)).toBe("transfer");
    expect(reasonOf(l2, opening.id)).toBe("opening_balance");
    expect(l2.transferLinks).toHaveLength(0);
    // Even a stray override can't make it income.
    const forced = buildLedger({ ...after, overrides: after.overrides.map((o) => ({ ...o, bucket: "income" as const })) });
    expect(bucketOf(forced, opening.id)).toBe("transfer");
    const t = monthTotals(l2, "2026-10");
    expect([t.incomeCents, t.spendingCents]).toEqual([0, 0]);
    expect(savedByDestination(l2, ["2026-10"]).value.find((s) => s.accountId === "wallet")!.totalCents).toBe(0);
  });

  it("cash transactions follow the same rules (an unlabelled cash purchase is spending)", () => {
    expect(bucketOf(l, "cash_market")).toBe("spending");
  });
});

describe("income is complete (§6)", () => {
  const { data } = flowsFixture();
  const l = buildLedger(data);

  it("paychecks, HYSA interest and brokerage dividends are income", () => {
    expect(bucketOf(l, "pay_10")).toBe("income");
    expect(bucketOf(l, "interest_09")).toBe("income");
    const div = l.byTransaction.get("itx_div")![0]!;
    expect(div.bucket).toBe("income");
    expect(div.category).toBe("INCOME_DIVIDENDS");
    expect(div.source).toBe("investment_transaction");
  });

  it("refunds, reimbursements and transfers in from my own accounts are not income", () => {
    expect(bucketOf(l, "amazon_refund")).toBe("spending");
    expect(bucketOf(l, "amazon_refund_unlinked")).toBe("spending");
    expect(bucketOf(l, "hysa_in_10")).toBe("transfer");
    const reimbursement = buildLedger(mini([txn("venmo_back", "chk", 3000, "2026-10-02", { raw: "VENMO FROM SAM DINNER" })]));
    expect(bucketOf(reimbursement, "venmo_back")).toBe("spending");
  });

  it("income layers: Plaid category → payer rule → per-transaction override → account fallback", () => {
    const rows = [
      txn("side_gig", "chk", 50000, "2026-10-02", { raw: "STRIPE TRANSFER GIGCO" }),
      txn("deposit", "hysa", 1000, "2026-10-03", { raw: "MOBILE DEPOSIT" }),
      txn("bonus", "chk", 20000, "2026-10-04", { raw: "ACME BONUS", detailed: "INCOME_WAGES" }),
      txn("clawback", "chk", -5000, "2026-10-05", { raw: "ACME PAYROLL CORRECTION", detailed: "INCOME_WAGES" }),
    ];
    const base = mini(rows);
    let l2 = buildLedger(base);
    expect(bucketOf(l2, "side_gig")).toBe("spending");
    expect(bucketOf(l2, "bonus")).toBe("income");
    // Negative income (a clawback) reduces income.
    expect(monthTotals(l2, "2026-10").incomeCents).toBe(15000);

    // Payer rule.
    l2 = buildLedger({
      ...base,
      rules: [{ id: "r1", position: 0, matchKind: "description_contains", matchValue: "GIGCO", accountId: null, setCategory: null, setBucket: "income", setNecessity: null, enabled: true, createdAt: "x" }],
    });
    expect(bucketOf(l2, "side_gig")).toBe("income");
    expect(reasonOf(l2, "side_gig")).toBe("rule");

    // Account fallback for plain deposits only.
    l2 = buildLedger({ ...base, accounts: base.accounts.map((a) => (a.id === "hysa" ? { ...a, incomeFallback: true } : a)) });
    expect(bucketOf(l2, "deposit")).toBe("income");
    expect(reasonOf(l2, "deposit")).toBe("account_fallback");

    // Per-transaction override beats everything.
    l2 = buildLedger({
      ...base,
      overrides: [{ transactionId: "bonus", category: null, bucket: "spending", necessity: null, note: null, confirmedAt: null, updatedAt: "x" }],
    });
    expect(bucketOf(l2, "bonus")).toBe("spending");
  });
});

describe("rule order: my fix → my rules → Plaid (§6, decision 005)", () => {
  const rows = [txn("t1", "card", -1000, "2026-10-02", { merchantName: "Corner Store", detailed: "FOOD_AND_DRINK_GROCERIES" })];
  const rule = { id: "r1", position: 0, matchKind: "merchant" as const, matchValue: "auto:CORNER", accountId: null, setCategory: "FOOD_AND_DRINK_COFFEE", setBucket: null, setNecessity: null, enabled: true, createdAt: "x" };
  const ov = { transactionId: "t1", category: "GENERAL_MERCHANDISE_OTHER", bucket: null, necessity: null, note: null, confirmedAt: null, updatedAt: "x" };

  it("Plaid's category when nothing else applies", () => {
    expect(buildLedger(mini(rows)).byTransaction.get("t1")![0]!.category).toBe("FOOD_AND_DRINK_GROCERIES");
  });
  it("a rule beats Plaid", () => {
    expect(normalizeMerchantKey("Corner Store")).toBe("CORNER");
    expect(buildLedger(mini(rows, { rules: [rule] })).byTransaction.get("t1")![0]!.category).toBe("FOOD_AND_DRINK_COFFEE");
  });
  it("my per-transaction fix beats a rule", () => {
    expect(buildLedger(mini(rows, { rules: [rule], overrides: [ov] })).byTransaction.get("t1")![0]!.category).toBe("GENERAL_MERCHANDISE_OTHER");
  });
  it("a disabled rule or one for another account does nothing; the earlier rule wins", () => {
    expect(buildLedger(mini(rows, { rules: [{ ...rule, enabled: false }] })).byTransaction.get("t1")![0]!.category).toBe("FOOD_AND_DRINK_GROCERIES");
    expect(buildLedger(mini(rows, { rules: [{ ...rule, accountId: "chk" }] })).byTransaction.get("t1")![0]!.category).toBe("FOOD_AND_DRINK_GROCERIES");
    const later = { ...rule, id: "r2", position: 5, setCategory: "TRAVEL_FLIGHTS" };
    expect(buildLedger(mini(rows, { rules: [later, rule] })).byTransaction.get("t1")![0]!.category).toBe("FOOD_AND_DRINK_COFFEE");
  });
});

describe("which date counts, pending, and edge cases (§1)", () => {
  it("the authorized (purchase) date counts when present, else the posted date", () => {
    expect(effectiveDate({ authorizedDate: "2026-10-31", date: "2026-11-02" })).toBe("2026-10-31");
    expect(effectiveDate({ authorizedDate: null, date: "2026-11-02" })).toBe("2026-11-02");
  });

  it("month boundary: bought Oct 31, posted Nov 2 → October spending", () => {
    const l = buildLedger(mini([txn("late", "card", -4200, "2026-11-02", { authorizedDate: "2026-10-31", detailed: "FOOD_AND_DRINK_RESTAURANT" })]));
    expect(monthTotals(l, "2026-10").spendingCents).toBe(4200);
    expect(monthTotals(l, "2026-11").spendingCents).toBe(0);
  });

  it("leap day counts in February", () => {
    const l = buildLedger(mini([txn("leap", "card", -2900, "2028-02-29", { detailed: "FOOD_AND_DRINK_GROCERIES" })]));
    expect(monthTotals(l, "2028-02").spendingCents).toBe(2900);
    expect(monthTotals(l, "2028-03").spendingCents).toBe(0);
  });

  it("time zones: 'today' is computed in the user's zone at the edge, so a late-evening purchase stays in its month", () => {
    // 2026-11-01 02:30 UTC is still Oct 31 in New York.
    const instant = Date.UTC(2026, 10, 1, 2, 30);
    const today = isoDateInTimeZone(instant, "America/New_York");
    expect(today).toBe("2026-10-31");
    expect(isoDateInTimeZone(instant, "Europe/Lisbon")).toBe("2026-11-01");
    const l = buildLedger(mini([txn("evening", "card", -1000, today, { detailed: "FOOD_AND_DRINK_RESTAURANT" })]));
    expect(monthTotals(l, "2026-10").spendingCents).toBe(1000);
  });

  it("zero amounts are harmless and negative spending (a credit) reduces the total", () => {
    const l = buildLedger(
      mini([
        txn("zero", "card", 0, "2026-10-02", { detailed: "GENERAL_MERCHANDISE_OTHER" }),
        txn("buy", "card", -5000, "2026-10-03", { detailed: "GENERAL_MERCHANDISE_OTHER" }),
        txn("credit", "card", 1500, "2026-10-04", { detailed: "GENERAL_MERCHANDISE_OTHER" }),
      ]),
    );
    expect(bucketOf(l, "zero")).toBe("spending");
    expect(spendCents(l.byTransaction.get("zero")![0]!)).toBe(0);
    expect(Object.is(spendCents(l.byTransaction.get("zero")![0]!), -0)).toBe(false);
    expect(monthTotals(l, "2026-10").spendingCents).toBe(3500);
  });

  it("pending charges are classified but excluded from totals; removed ones are gone", () => {
    const { data } = flowsFixture();
    const l = buildLedger(data);
    expect(bucketOf(l, "gas_pending")).toBe("spending");
    expect(inPeriod(l.entries, "2026-10-01", "2026-10-31").some((e) => e.transactionId === "gas_pending")).toBe(false);
    expect(l.byTransaction.has("old_removed")).toBe(false);
  });
});

describe("hand-checked October totals of the flows fixture", () => {
  const { data } = flowsFixture();
  const l = buildLedger(data);
  it("income, Poker net, spending and saved", () => {
    const t = monthTotals(l, "2026-10");
    // pay 300000 + dividend 2500 + Poker (20000 − 25000)
    expect(t.pokerNetCents).toBe(-5000);
    expect(t.incomeCents).toBe(300000 + 2500 - 5000);
    // rent 150000, trip cafe 20000, coffee 6×500, groceries 21000, amazon 2500 − 2500 unlinked refund,
    // Nopa 9000 + 8000, Costco 15000, Netflix 2×1299, TV 90000, cash market 1500.
    // (The Amazon refund linked to September counts in September; pending gas doesn't count.)
    const expected = 150000 + 20000 + 3000 + 21000 + 2500 - 2500 + 9000 + 8000 + 15000 + 2598 + 90000 + 1500;
    expect(t.spendingCents).toBe(expected);
    expect(t.savedCents).toBe(t.incomeCents - t.spendingCents);
  });
  it("September: the October refund linked to the September purchase reduces September's spending", () => {
    // rent 150000 + groceries 20000 + Nopa 6000 + flight 50000 + Amazon 10000 − refund 4000
    expect(monthTotals(l, "2026-09").spendingCents).toBe(150000 + 20000 + 6000 + 50000 + 10000 - 4000);
  });
});
