import { describe, expect, it } from "vitest";
import {
  activityList,
  allocation,
  assetType,
  classifyActivity,
  contributionItems,
  holdingsByAccount,
  holdingsHistory,
  performance,
} from "../../src/investments/index.ts";
import { account, holding, itx, security, tx } from "./builders.ts";

const TODAY = "2026-11-18";
const brk = account({ id: "brk", type: "investment", subtype: "brokerage", name: "Brokerage", connectedOn: "2026-09-01", currentBalanceCents: 1 });
const ira = account({ id: "ira", type: "investment", subtype: "ira", name: "IRA", connectedOn: "2026-10-01", currentBalanceCents: 1 });
const chk = account({ id: "chk" });
const securities = [security("vti", "etf", "VTI", "Vanguard Total"), security("aapl", "equity", "AAPL", "Apple"), security("cash", "cash", null, "Cash sweep"), security("vfiax", "mutual fund", "VFIAX", "500 Index")];
const holdings = [
  holding("brk", "vti", "2026-09-01", 900_000, 40),
  holding("brk", "aapl", "2026-09-01", 100_000, 5),
  holding("brk", "vti", "2026-08-20", 1, 1), // before connection: not history
  holding("brk", "vti", TODAY, 1_050_000, 42),
  holding("brk", "aapl", TODAY, 150_000, 5.5),
  holding("brk", "cash", TODAY, 50_000, 500),
  holding("ira", "vfiax", "2026-10-01", 400_000, 7),
  holding("ira", "vti", "2026-10-01", 100_000, 4),
  holding("ira", "vfiax", TODAY, 420_000, 7),
  holding("ira", "vti", TODAY, 130_000, 5),
];

describe("§17 holdings and allocation", () => {
  it("holdings per account: name, ticker, quantity, value, share of the account", () => {
    const [b, i] = holdingsByAccount([brk, ira, chk], holdings, securities, TODAY);
    expect(b!.asOfDate).toBe(TODAY);
    expect(b!.totalValueCents).toBe(1_250_000);
    expect(b!.holdings.map((h) => [h.name, h.ticker, h.quantity, h.valueCents, h.shareOfAccount])).toEqual([
      ["Vanguard Total", "VTI", 42, 1_050_000, 0.84],
      ["Apple", "AAPL", 5.5, 150_000, 0.12],
      ["Cash sweep", null, 500, 50_000, 0.04],
    ]);
    expect(i!.holdings).toHaveLength(2);
    expect(holdingsByAccount([brk], holdings, securities, "2026-10-15")[0]!.asOfDate).toBe("2026-09-01");
  });

  it("allocation by type and by holding across accounts", () => {
    const a = allocation(holdingsByAccount([brk, ira], holdings, securities, TODAY));
    expect(a.totalCents).toBe(1_800_000);
    expect(a.byType.map((s) => [s.key, s.valueCents])).toEqual([
      ["etfs", 1_180_000],
      ["funds", 420_000],
      ["stocks", 150_000],
      ["cash", 50_000],
    ]);
    expect(a.byHolding[0]).toMatchObject({ key: "vti", label: "Vanguard Total (VTI)", valueCents: 1_180_000 });
    expect(a.byType.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1);
    expect(assetType("fixed income")).toBe("bonds");
    expect(assetType(null)).toBe("other");
  });
});

describe("§17 activity classification", () => {
  it("buys/sells are neither spending nor income, dividends are income, fees are fees", () => {
    expect(classifyActivity({ type: "buy", subtype: "buy", amountCents: -100 })).toEqual({ kind: "buy", countsAs: "neither" });
    expect(classifyActivity({ type: "sell", subtype: "sell", amountCents: 100 })).toEqual({ kind: "sell", countsAs: "neither" });
    expect(classifyActivity({ type: "cash", subtype: "dividend", amountCents: 3150 })).toEqual({ kind: "dividend", countsAs: "income" });
    expect(classifyActivity({ type: "cash", subtype: "qualified dividend", amountCents: 1 })).toEqual({ kind: "dividend", countsAs: "income" });
    expect(classifyActivity({ type: "cash", subtype: "interest", amountCents: 1 })).toEqual({ kind: "interest", countsAs: "income" });
    expect(classifyActivity({ type: "fee", subtype: "account fee", amountCents: -500 })).toEqual({ kind: "fee", countsAs: "fee" });
    expect(classifyActivity({ type: "cash", subtype: "management fee", amountCents: -500 })).toEqual({ kind: "fee", countsAs: "fee" });
    expect(classifyActivity({ type: "cash", subtype: "deposit", amountCents: 500 })).toEqual({ kind: "transfer_in", countsAs: "neither" });
    expect(classifyActivity({ type: "transfer", subtype: "withdrawal", amountCents: -500 })).toEqual({ kind: "transfer_out", countsAs: "neither" });
    expect(classifyActivity({ type: "buy", subtype: "dividend reinvestment", amountCents: -1 })).toEqual({ kind: "buy", countsAs: "neither" });
    expect(classifyActivity({ type: "cash", subtype: "adjustment", amountCents: 1 })).toEqual({ kind: "other", countsAs: "neither" });
  });

  it("lists activity newest first with notes and securities", () => {
    const list = activityList(
      [itx("a", "brk", "2026-10-01", "buy", "buy", -50_000, { securityId: "vti", quantity: 2, note: "monthly buy" }), itx("b", "brk", "2026-10-15", "cash", "dividend", 3150, { securityId: "vti" }), itx("c", "ira", "2026-10-20", "fee", null, -100)],
      securities,
      { accountId: "brk" },
    );
    expect(list.map((r) => [r.id, r.kind, r.countsAs, r.ticker, r.note])).toEqual([
      ["b", "dividend", "income", "VTI", null],
      ["a", "buy", "neither", "VTI", "monthly buy"],
    ]);
  });
});

describe("§17 performance: contributions from transfers in minus out, not cost basis", () => {
  const itxs = [
    itx("dep1", "brk", "2026-09-15", "cash", "deposit", 200_000),
    itx("wd1", "brk", "2026-10-15", "cash", "withdrawal", -50_000),
    itx("old", "brk", "2026-08-01", "cash", "deposit", 999_999), // before history starts
    itx("buy1", "brk", "2026-09-16", "buy", "buy", -200_000, { securityId: "vti" }),
    itx("div", "brk", "2026-10-15", "cash", "dividend", 3150),
  ];
  const txs = [tx("ira", "2026-10-10", 30_000, { id: "ira_in" }), tx("ira", "2026-10-11", 99, { id: "unlinked" })];
  const links = [{ id: "l", outTransactionId: "chk_out", inTransactionId: "ira_in", source: "auto" as const, undoneAt: null, needsReview: false, createdAt: "" }];

  it("per account and in total, in dollars and percent", () => {
    const p = performance({ accounts: [brk, ira, chk], holdings, investmentTransactions: itxs, transactions: txs, transferLinks: links, today: TODAY });
    const b = p.accounts.find((a) => a.accountId === "brk")!;
    expect(b).toMatchObject({
      historyStartsOn: "2026-09-01",
      startingValueCents: 1_000_000,
      netTransfersCents: 150_000,
      contributedCents: 1_150_000,
      valueCents: 1_250_000,
      gainCents: 100_000,
      investmentTransactionIds: ["dep1", "wd1"],
    });
    expect(b.gainPct).toBeCloseTo(100_000 / 1_150_000);
    const i = p.accounts.find((a) => a.accountId === "ira")!;
    expect(i).toMatchObject({ contributedCents: 530_000, valueCents: 550_000, gainCents: 20_000, transferTransactionIds: ["ira_in"] });
    expect(p.total).toMatchObject({ contributedCents: 1_680_000, valueCents: 1_800_000, gainCents: 120_000, historyStartsOn: "2026-09-01" });
    expect(p.total.gainPct).toBeCloseTo(120_000 / 1_680_000);
    expect(b.note).toMatch(/2026-09-01/);
  });

  it("contribution items come from transfer activity and linked transfer halves only", () => {
    expect(contributionItems("brk", itxs, txs, links).map((c) => c.id)).toEqual(["old", "dep1", "wd1"]);
    expect(contributionItems("ira", itxs, txs, links).map((c) => c.id)).toEqual(["ira_in"]);
  });
});

describe("§17 holdings history from the connection date", () => {
  it("keeps history from connection with a history-starts marker", () => {
    const h = holdingsHistory([brk, ira], holdings);
    expect(h[0]!.historyStartsOn).toBe("2026-09-01");
    expect(h[0]!.points.map((p) => [p.date, p.valueCents])).toEqual([
      ["2026-09-01", 1_000_000],
      [TODAY, 1_250_000],
    ]);
    expect(h[1]!.historyStartsOn).toBe("2026-10-01");
  });
});
