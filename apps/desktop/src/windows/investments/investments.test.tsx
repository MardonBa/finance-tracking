// @vitest-environment jsdom
/** §17 Investments window against real core outputs (fixtures from @ft/core). */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { InvestmentTransaction } from "@ft/core";
import { basicFixture } from "@ft/core/fixtures";
import { installCoreBackend } from "../../test/coreBackend.tsx";
import { renderWithToken } from "../../test/render.tsx";
import { lastChart } from "../../test/chartStub.tsx";
import { InvestmentsWindow } from "./InvestmentsWindow.tsx";

vi.mock("../../ui/Chart.tsx", () => import("../../test/chartStub.tsx"));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const itx = (id: string, date: string, type: string, subtype: string, amountCents: number, over: Partial<InvestmentTransaction> = {}): InvestmentTransaction => ({
  id,
  plaidInvestmentTransactionId: null,
  accountId: "acc_brokerage",
  securityId: null,
  date,
  type,
  subtype,
  amountCents,
  quantity: null,
  feesCents: null,
  rawDescription: id,
  note: null,
  ...over,
});

/** Brokerage connected Sep 1 at $18,000 (VTI + cash), $1,000 transferred in since, now $21,045 VTI + $500 cash. */
function fixture() {
  const { data, today } = basicFixture();
  data.securities.push({ id: "sec_cash", plaidSecurityId: "p_cash", name: "Cash sweep", tickerSymbol: null, type: "cash" });
  data.holdings = [
    { accountId: "acc_brokerage", securityId: "sec_vti", asOfDate: "2026-09-01", quantity: 60, valueCents: 1_750_000, isoCurrencyCode: "USD" },
    { accountId: "acc_brokerage", securityId: "sec_cash", asOfDate: "2026-09-01", quantity: 500, valueCents: 50_000, isoCurrencyCode: "USD" },
    { accountId: "acc_brokerage", securityId: "sec_vti", asOfDate: "2026-10-31", quantity: 70.5, valueCents: 2_104_500, isoCurrencyCode: "USD" },
    { accountId: "acc_brokerage", securityId: "sec_cash", asOfDate: "2026-10-31", quantity: 500, valueCents: 50_000, isoCurrencyCode: "USD" },
  ];
  data.investmentTransactions.push(
    itx("itx_deposit", "2026-10-02", "transfer", "deposit", 100_000, { rawDescription: "ACH DEPOSIT" }),
    itx("itx_buy", "2026-10-03", "buy", "buy", -95_000, { securityId: "sec_vti", quantity: 3, rawDescription: "BUY VTI" }),
    itx("itx_fee", "2026-10-20", "fee", "account fee", -500, { rawDescription: "ACCOUNT FEE" }),
  );
  return { data, today };
}

describe("Investments", () => {
  it("shows each account's value and holdings: name, ticker, quantity, value and share, with where history starts", async () => {
    installCoreBackend(fixture());
    renderWithToken(<InvestmentsWindow />);
    const table = await screen.findByRole("table", { name: "Plaid Brokerage holdings" });
    const rows = within(table).getAllByRole("row").slice(1).map((r) => r.textContent);
    expect(rows).toEqual(["Vanguard Total Stock Market ETFVTI70.5$21,045.0097.7%", "Cash sweep–500$500.002.3%"]);
    expect(screen.getAllByText("$21,545.00").length).toBeGreaterThan(0);
    expect(await screen.findByText(/Holdings history starts Sep 1, 2026, when the account was connected/)).toBeTruthy();
  });

  it("breaks the allocation down by type and by holding", async () => {
    installCoreBackend(fixture());
    renderWithToken(<InvestmentsWindow />);
    await userEvent.click(await screen.findByRole("tab", { name: "Allocation" }));
    const byType = await screen.findByRole("table", { name: "Allocation by type" });
    expect(within(byType).getAllByRole("row").slice(1).map((r) => r.textContent)).toEqual(["ETFs$21,045.0097.7%", "Cash$500.002.3%"]);
    await userEvent.click(screen.getByRole("radio", { name: "By holding" }));
    const byHolding = await screen.findByRole("table", { name: "Allocation by holding" });
    expect(within(byHolding).getAllByRole("row")[1]!.textContent).toBe("Vanguard Total Stock Market ETF (VTI)$21,045.0097.7%");
    expect(lastChart(/Allocation by holding/)).toBeTruthy();
  });

  it("compares what I put in (from transfers in, not cost basis) with the value, per account and in total, with history-start markers", async () => {
    installCoreBackend(fixture());
    renderWithToken(<InvestmentsWindow />);
    await userEvent.click(await screen.findByRole("tab", { name: "Performance" }));
    const table = await screen.findByRole("table", { name: "Performance per account" });
    // Put in = $18,000 on Sep 1 + $1,000 deposit = $19,000; value $21,545 → +$2,545 (+13.4%).
    expect(within(table).getAllByRole("row")[1]!.textContent).toBe("Plaid Brokerage$19,000.00+$1,000.00$21,545.00+$2,545.00 (+13.4%)Sep 1, 2026");
    expect(within(table).getAllByRole("row").at(-1)!.textContent).toBe("Total$19,000.00+$1,000.00$21,545.00+$2,545.00 (+13.4%)");
    await waitFor(() => expect(lastChart(/Plaid Brokerage value over time, history starts 2026-09-01/)).toBeTruthy());
    const option = lastChart(/Plaid Brokerage value over time/)!.option as { series: Array<{ markLine: { label: { formatter: string }; data: unknown[] } }> };
    expect(option.series[0]!.markLine.label.formatter).toBe("History starts");
    expect(option.series[0]!.markLine.data).toHaveLength(1);
  });

  it("lists buys, sells, dividends and fees; dividends count as income; notes are saved through investments.setNote", async () => {
    const backend = installCoreBackend(fixture());
    renderWithToken(<InvestmentsWindow />);
    await userEvent.click(await screen.findByRole("tab", { name: "Activity" }));
    const table = await screen.findByRole("table", { name: "Investment activity" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell")[1]!.textContent)).toEqual(["Fee", "Dividend", "Buy", "Transfer in"]);
    expect(within(rows[1]!).getByText("Income")).toBeTruthy();
    expect(within(rows[2]!).getByText("Not spending or income")).toBeTruthy();
    expect(screen.getByText("$31.50")).toBeTruthy(); // dividend income

    await userEvent.click(within(rows[1]!).getByRole("button", { name: "Add note on VTI DIVIDEND" }));
    await userEvent.type(screen.getByLabelText("Note"), "Quarterly");
    await userEvent.click(screen.getByRole("button", { name: "Save note…" }));
    expect(await screen.findByText(/Set the note on VTI DIVIDEND/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(backend.data.investmentTransactions.find((t) => t.id === "itx_dividend")!.note).toBe("Quarterly"));
    expect(await screen.findByText("Quarterly")).toBeTruthy();
  });
});
