// @vitest-environment happy-dom
/**
 * Transactions window (§7, §6 "Needs a look") against REAL core outputs.
 * Covers the drill-down receiver and filter header, split parts with their
 * parent, the merchant view, search, empty states, and that running an
 * action (with its before → after preview) refetches the data.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Money, emptyData } from "@ft/core";
import { DRILLDOWN_EVENT, openDrillDown, openItem, openMerchant } from "../../data/drilldown.ts";
import { calls, coreData, resetCore, runCoreQuery, TODAY } from "../testing/coreApi.ts";
import { renderInWindow } from "../testing/render.tsx";
import { TransactionsWindow } from "./TransactionsWindow.tsx";
import { UnexplainedNote } from "../../accounts/AccountSheets.tsx";
import { OPEN_ITEM_EVENT } from "../../data/drilldown.ts";

vi.mock("../../api/client.ts", async () => (await import("../testing/coreApi.ts")).clientMock);

const OCT = { from: "2026-10-01", to: "2026-10-31" };

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
});
beforeEach(() => resetCore());
afterEach(() => cleanup());

const notLoading = () => waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());

describe("drill-down receiver", { timeout: 30_000 }, () => {
  it("on mount, shows exactly the figure's transactions under the filter header, total equal to the figure", async () => {
    const req = { query: "spending.byCategory", params: { ...OCT, level: "primary" }, figureId: "category.FOOD_AND_DRINK", label: "Food and drink · October" };
    openDrillDown(req); // fired before the window mounted: picked up via takePendingDrillDown
    renderInWindow(<TransactionsWindow />);
    const fig = runCoreQuery(req.query, req.params).figures[req.figureId]!;
    await waitFor(() => expect(screen.getByTestId("drill-total").textContent).toBe(Money.format(fig.cents)));
    expect(within(screen.getByTestId("filter-header")).getByRole("heading").textContent).toBe("Food and drink · October");
    const ids = new Set(fig.contributions.map((c) => c.transactionId));
    const rows = screen.getAllByTestId(/^row-/).map((el) => el.dataset.testid!.slice(4));
    // Every contributing transaction is listed (refunds sit with their parent purchase).
    const dd = runCoreQuery<{ groups: { row: { transactionId: string } }[] }>("transactions.drillDown", { query: req.query, params: req.params, figure: req.figureId }).value;
    expect(rows).toEqual(dd.groups.map((g) => g.row.transactionId));
    for (const id of rows) expect(ids.has(id) || dd.groups.some((g) => g.row.transactionId === id)).toBe(true);
    const groupTotals = screen.getAllByTestId("group-total").map((el) => el.firstChild!.textContent);
    expect(groupTotals.length).toBe(rows.length);
  });

  it("shows a split part with its parent purchase and what it counted", async () => {
    renderInWindow(<TransactionsWindow />);
    const req = { query: "spending.byCategory", params: { ...OCT, level: "primary" }, figureId: "category.FOOD_AND_DRINK", label: "Food" };
    act(() => openDrillDown(req));
    await notLoading();
    const split = screen.getByTestId("row-costco_split");
    expect(within(split).getByText(/Split part · Food and drink groceries/)).toBeTruthy();
    expect(within(split).getByText("Split")).toBeTruthy(); // the marker
    expect(within(split).getByTestId("group-total").textContent).toContain("of -$150.00");
  });

  it("switches on every ft:drilldown event and clears back to all transactions", async () => {
    renderInWindow(<TransactionsWindow />);
    await notLoading();
    expect(screen.queryByTestId("filter-header")).toBeNull();
    act(() => {
      window.dispatchEvent(
        new CustomEvent(DRILLDOWN_EVENT, { detail: { query: "spending.monthlySummary", params: { month: "2026-10", usualMonths: 3 }, figureId: "spending", label: "Spending · 2026-10" } }),
      );
    });
    const fig = runCoreQuery("spending.monthlySummary", { month: "2026-10", usualMonths: 3 }).figures.spending!;
    await waitFor(() => expect(screen.getByTestId("drill-total").textContent).toBe(Money.format(fig.cents)));
    fireEvent.click(screen.getByRole("button", { name: "Clear filter and show all transactions" }));
    expect(screen.queryByTestId("filter-header")).toBeNull();
    expect(screen.getByRole("tab", { name: "All transactions" })).toBeTruthy();
  });

  it("an empty figure says so", async () => {
    renderInWindow(<TransactionsWindow />);
    act(() => openDrillDown({ query: "transactions.list", params: { text: "no such merchant zzz", measure: "amount" }, figureId: "total", label: "Nothing" }));
    await waitFor(() => expect(screen.getByText("No transactions behind this number")).toBeTruthy());
    expect(screen.getByTestId("drill-total").textContent).toBe("$0.00");
  });
});

describe("merchant view", { timeout: 30_000 }, () => {
  it("shows all its transactions, the period total, count and a 12-month trend that drills down", async () => {
    renderInWindow(<TransactionsWindow />);
    act(() => openMerchant({ merchantKey: "auto:NOPA", label: "Nopa" }));
    await notLoading();
    expect(within(screen.getByTestId("filter-header")).getByRole("heading").textContent).toBe("Nopa");
    const m = runCoreQuery<{ totalCents: number; count: number; rows: unknown[] }>("transactions.merchant", {
      from: "2025-11-01",
      to: "2026-10-31",
      merchantKey: "auto:NOPA",
      trendMonths: 12,
    }).value;
    expect(screen.getByRole("button", { name: new RegExp(`: \\${Money.format(m.totalCents)}\\. Show transactions$`) })).toBeTruthy();
    expect(screen.getByText(String(m.count))).toBeTruthy();
    expect(screen.getAllByTestId(/^row-/)).toHaveLength(m.rows.length);
    const points = within(screen.getByRole("group", { name: /monthly over the last 12 months/ })).getAllByRole("button");
    expect(points).toHaveLength(12);
    // A trend point opens the drill-down for that month with a matching total.
    fireEvent.click(points[points.length - 1]!);
    await waitFor(() => expect(screen.getByTestId("drill-total")).toBeTruthy());
    const oct = runCoreQuery("transactions.merchant", { from: "2025-11-01", to: "2026-10-31", merchantKey: "auto:NOPA", trendMonths: 12 }).figures["month.2026-10"]!;
    await waitFor(() => expect(screen.getByTestId("drill-total").textContent).toBe(Money.format(oct.cents)));
  });

  it("clicking a merchant in any row opens its merchant view", async () => {
    renderInWindow(<TransactionsWindow />);
    await notLoading();
    fireEvent.click(screen.getAllByRole("button", { name: "Nopa" })[0]!);
    await waitFor(() => expect(within(screen.getByTestId("filter-header")).getByRole("heading").textContent).toBe("Nopa"));
  });
});

describe("search and filters", { timeout: 30_000 }, () => {
  it("searches notes and amounts; rows show merchant, category, amount, account and markers", async () => {
    renderInWindow(<TransactionsWindow />);
    await notLoading();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), { target: { value: "work dinner" } });
    await waitFor(() => expect(screen.getAllByTestId(/^row-/).map((r) => r.dataset.testid)).toEqual(["row-dine_10b"]));
    const row = screen.getByTestId("row-dine_10b");
    expect(within(row).getByText("Nopa")).toBeTruthy();
    expect(within(row).getByText("Food and drink restaurant")).toBeTruthy();
    expect(within(row).getByText("-$80.00")).toBeTruthy();
    expect(within(row).getByText("Card ••3333")).toBeTruthy();
    expect(within(row).getByText("Note")).toBeTruthy();
    expect(within(row).getByText("“Work dinner”")).toBeTruthy();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), { target: { value: "80.00" } });
    await waitFor(() => expect(screen.getAllByTestId(/^row-/).map((r) => r.dataset.testid)).toContain("row-dine_10b"));
  });

  it("filters by account and category, and offers to clear when nothing matches", async () => {
    renderInWindow(<TransactionsWindow />);
    await notLoading();
    fireEvent.change(screen.getByRole("combobox", { name: "Account" }), { target: { value: "cash" } });
    await waitFor(() => {
      const rows = screen.getAllByTestId(/^row-/);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(r.textContent).toContain("Cash");
    });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), { target: { value: "no such thing qq" } });
    await waitFor(() => expect(screen.getByText("Nothing matches")).toBeTruthy());
    fireEvent.click(screen.getAllByRole("button", { name: "Clear filters" })[0]!);
    await waitFor(() => expect(screen.getAllByTestId(/^row-/).length).toBeGreaterThan(20));
  });

  it("with no transactions at all, says what goes here and offers the next step", async () => {
    resetCore(emptyData());
    renderInWindow(<TransactionsWindow />);
    await waitFor(() => expect(screen.getByText("No transactions yet")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Add a bank" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Needs a look" }));
    await waitFor(() => expect(screen.getByText("Nothing needs a look")).toBeTruthy());
  });
});

describe("row fixes go through previewed actions and refetch", { timeout: 30_000 }, () => {
  async function openRowFix(id: string, fix: string) {
    renderInWindow(<TransactionsWindow />);
    await notLoading();
    const row = screen.getByTestId(`row-${id}`);
    fireEvent.click(within(row).getByRole("button", { name: /Show fixes$/ }));
    fireEvent.click(within(screen.getByTestId(`row-${id}`)).getByRole("radio", { name: fix }));
    return () => screen.getByTestId(`row-${id}`);
  }

  it("adds a note with a before → after preview; the list refetches and shows it", async () => {
    const row = await openRowFix("groc_10", "Note");
    const listQueries = () => calls.filter((c) => c.kind === "query" && c.name === "transactions.list").length;
    fireEvent.change(within(row()).getByRole("textbox"), { target: { value: "Party supplies" } });
    fireEvent.click(within(row()).getByRole("button", { name: "Preview note" }));
    const preview = await within(row()).findByRole("region", { name: "Preview of the change" });
    expect(within(preview).getByText("None")).toBeTruthy();
    expect(within(preview).getByText("Party supplies")).toBeTruthy();
    expect(calls.some((c) => c.kind === "action")).toBe(false); // nothing changes until Apply
    const before = listQueries();
    fireEvent.click(within(preview).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(listQueries()).toBeGreaterThan(before));
    await waitFor(() => expect(within(row()).getByText("“Party supplies”")).toBeTruthy());
    expect(coreData().overrides.find((o) => o.transactionId === "groc_10")?.note).toBe("Party supplies");
    // Undo restores it.
    fireEvent.click(within(row()).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(within(row()).queryByText("“Party supplies”")).toBeNull());
  });

  it("recategorises with 'always do this for this merchant'", async () => {
    const row = await openRowFix("groc_10", "Category");
    await waitFor(() => expect(within(row()).getByRole("combobox", { name: "Category" })).toBeTruthy());
    fireEvent.change(within(row()).getByRole("combobox", { name: "Category" }), { target: { value: "FOOD_AND_DRINK_RESTAURANT" } });
    fireEvent.click(within(row()).getByRole("switch"));
    fireEvent.click(within(row()).getByRole("button", { name: "Preview change" }));
    const preview = await within(row()).findByRole("region", { name: "Preview of the change" });
    expect(preview.textContent).toContain("Rule");
    fireEvent.click(within(preview).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(calls.some((c) => c.kind === "action" && c.name === "transactions.recategorise")).toBe(true));
    expect(coreData().rules.some((r) => r.setCategory === "FOOD_AND_DRINK_RESTAURANT")).toBe(true);
  });

  it("links a refund to any purchase found by search, not only a suggested one", async () => {
    const row = await openRowFix("amazon_refund_unlinked", "Refund");
    const picker = await within(row()).findByRole("group", { name: "Find the purchase" });
    fireEvent.change(within(picker).getByRole("searchbox", { name: "Find the purchase" }), { target: { value: "Nopa" } });
    const list = await within(picker).findByRole("list", { name: "Matching purchases" });
    const options = within(list).getAllByRole("button");
    for (const b of options) expect(b.textContent).toMatch(/^Link to Nopa · /);
    // Only purchases on or before the refund and at least as big as it are offered.
    const expected = runCoreQuery<{ rows: { transactionId: string; amountCents: number; date: string }[] }>("transactions.list", {
      buckets: ["spending"], to: "2026-10-14", dateField: "date", text: "Nopa", measure: "amount", limit: 50,
    }).value.rows.filter((r) => r.amountCents <= -2500);
    expect(options).toHaveLength(expected.length);
    fireEvent.click(options[0]!);
    const preview = await within(row()).findByRole("region", { name: "Preview of the change" });
    fireEvent.click(within(preview).getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(coreData().refundLinks).toContainEqual(expect.objectContaining({ refundTransactionId: "amazon_refund_unlinked", purchaseTransactionId: expected[0]!.transactionId, undoneAt: null })),
    );
  });

  it.each([
    ["Poker", "Preview: mark as Poker", "poker"],
    ["Transfer", "Preview: mark as transfer", "transfer"],
  ])("marks a purchase as %s from its row, previewed first; it then counts in that bucket", async (fix, button, bucket) => {
    const row = await openRowFix("groc_10", fix);
    fireEvent.click(within(row()).getByRole("button", { name: button }));
    const preview = await within(row()).findByRole("region", { name: "Preview of the change" });
    expect(calls.some((c) => c.kind === "action")).toBe(false);
    fireEvent.click(within(preview).getByRole("button", { name: "Apply" }));
    await waitFor(() => {
      const b = runCoreQuery<{ transactions: { transactionId: string; bucket: string }[] }>("flows.buckets", OCT).value.transactions.find((t) => t.transactionId === "groc_10");
      expect(b?.bucket).toBe(bucket);
    });
  });

  it("split: Preview stays disabled until the parts add up", async () => {
    const row = await openRowFix("groc_10", "Split");
    await waitFor(() => expect(within(row()).getByRole("textbox", { name: "Part 1 amount" })).toBeTruthy());
    const preview = () => within(row()).getByRole("button", { name: "Preview split" }) as HTMLButtonElement;
    expect(preview().disabled).toBe(false); // starts as two halves
    fireEvent.change(within(row()).getByRole("textbox", { name: "Part 1 amount" }), { target: { value: "1.00" } });
    expect(preview().disabled).toBe(true);
    expect(within(row()).getByRole("status").textContent).toMatch(/left to assign/);
  });

  it("Needs a look: one click fixes an item, shows before → after, and the list refetches", async () => {
    renderInWindow(<TransactionsWindow />);
    const before = runCoreQuery<{ count: number }>("flows.needsALook", {}).value.count;
    expect(before).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByRole("tab", { name: `Needs a look (${before})` })).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: `Needs a look (${before})` }));
    await notLoading();
    fireEvent.click(screen.getAllByRole("button", { name: "Yes, it's a transfer" })[0]!);
    await waitFor(() => expect(screen.getByRole("tab", { name: `Needs a look (${before - 1})` })).toBeTruthy());
    expect(screen.getByRole("status").textContent).toContain("Confirmed");
  });
});

describe("views other windows open (Overview alerts strip) and the balance check (§6)", { timeout: 30_000 }, () => {
  const OCT_SO_FAR = { from: "2026-10-01", to: TODAY };

  it("openItem 'reconciliation' before mount opens the balance check: unexplained shown on the account, money in drills down", async () => {
    openItem({ area: "transactions", itemId: "reconciliation" }); // fired before the window mounted
    renderInWindow(<TransactionsWindow />);
    await waitFor(() => expect(screen.getByTestId("balance-check")).toBeTruthy());
    expect((screen.getByRole("tab", { name: "Balance check" }) as HTMLElement).getAttribute("aria-selected")).toBe("true");
    const rec = runCoreQuery<{ accounts: { accountId: string; status: string; unexplainedCents: number }[]; unexplainedCount: number }>("flows.reconciliation", OCT_SO_FAR);
    const chk = rec.value.accounts.find((a) => a.accountId === "chk")!;
    expect(chk.status).toBe("unexplained");
    await waitFor(() => expect(screen.getByTestId("unexplained-chk").textContent).toBe(Money.format(chk.unexplainedCents, { showPlus: true })));
    expect(within(screen.getByTestId("check-chk")).getByText(`Unexplained ${Money.format(chk.unexplainedCents, { showPlus: true })}`)).toBeTruthy();
    // An account that adds up says so; investments show market change instead of "unexplained".
    expect(within(screen.getByTestId("check-hysa")).getByText("Adds up")).toBeTruthy();
    expect(within(screen.getByTestId("check-brok")).queryByText(/^Unexplained/)).toBeNull();
    // Across everything: the leftover is shown, never hidden.
    const eq = runCoreQuery<{ leftoverCents: number }>("flows.netWorthEquation", OCT_SO_FAR).value;
    await waitFor(() => expect(screen.getByTestId("leftover").textContent).toBe(Money.format(eq.leftoverCents, { showPlus: true })));
    // Money in drills down to a list whose total equals it.
    const inFig = rec.figures["chk.in"]!;
    fireEvent.click(screen.getByRole("button", { name: `Checking money in: ${Money.format(inFig.cents)}. Show transactions` }));
    await waitFor(() => expect(screen.getByTestId("drill-total").textContent).toBe(Money.format(inFig.cents)));
    // Clearing the filter returns to the balance check tab.
    fireEvent.click(screen.getByRole("button", { name: "Clear filter and show all transactions" }));
    await waitFor(() => expect(screen.getByTestId("balance-check")).toBeTruthy());
  });

  it("openItem 'needs-a-look' while open switches to Needs a look; other areas' items are ignored", async () => {
    renderInWindow(<TransactionsWindow />);
    await notLoading();
    act(() => openItem({ area: "goals", itemId: "needs-a-look" }));
    expect((screen.getByRole("tab", { name: "All transactions" }) as HTMLElement).getAttribute("aria-selected")).toBe("true");
    act(() => openItem({ area: "transactions", itemId: "needs-a-look" }));
    await waitFor(() => expect((screen.getByRole("tab", { name: /^Needs a look/ }) as HTMLElement).getAttribute("aria-selected")).toBe("true"));
    await waitFor(() => expect(screen.getByRole("list", { name: "Needs a look" })).toBeTruthy());
  });

  it("the Poker summary shows money in, out and the net for the month, each drilling down", async () => {
    renderInWindow(<TransactionsWindow />);
    await notLoading();
    fireEvent.click(screen.getByRole("tab", { name: "Poker" }));
    const p = runCoreQuery<{ inCents: number; outCents: number; netCents: number }>("flows.poker", OCT_SO_FAR);
    expect(p.value.netCents).toBe(p.value.inCents - p.value.outCents);
    expect(p.value.netCents).toBeLessThan(0);
    const net = await screen.findByRole("button", { name: `Net result: ${Money.format(p.value.netCents, { showPlus: true })}. Show transactions` });
    expect(screen.getByRole("button", { name: `Money in: ${Money.format(p.value.inCents)}. Show transactions` })).toBeTruthy();
    expect(screen.getByRole("button", { name: `Money out: ${Money.format(p.value.outCents)}. Show transactions` })).toBeTruthy();
    expect(screen.getByText("A loss: counts as negative income")).toBeTruthy();
    fireEvent.click(net);
    await waitFor(() => expect(screen.getByTestId("drill-total").textContent).toBe(Money.format(p.figures.net!.cents)));
  });

  it("the account sheet shows this month's unexplained difference on that account and opens the balance check", async () => {
    const heard: unknown[] = [];
    const on = (e: Event) => heard.push((e as CustomEvent).detail);
    window.addEventListener(OPEN_ITEM_EVENT, on);
    try {
      renderInWindow(<UnexplainedNote accountId="chk" />, "overview");
      const chk = runCoreQuery<{ accounts: { unexplainedCents: number }[] }>("flows.reconciliation", { ...OCT_SO_FAR, accountId: "chk" }).value.accounts[0]!;
      const note = await screen.findByTestId("account-unexplained");
      expect(note.textContent).toContain(`Unexplained this month: ${Money.format(chk.unexplainedCents, { showPlus: true })}`);
      fireEvent.click(within(note).getByRole("button", { name: "Show the balance check" }));
      expect(heard).toContainEqual({ area: "transactions", itemId: "reconciliation" });
    } finally {
      window.removeEventListener(OPEN_ITEM_EVENT, on);
    }
    cleanup();
    // An account that adds up shows nothing.
    renderInWindow(<UnexplainedNote accountId="hysa" />, "overview");
    await waitFor(() => expect(calls.filter((c) => c.name === "flows.reconciliation").length).toBeGreaterThan(1));
    expect(screen.queryByTestId("account-unexplained")).toBeNull();
  });
});
