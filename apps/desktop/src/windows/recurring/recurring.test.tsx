// @vitest-environment jsdom
/** §9 Recurring window against real core outputs (fixtures from @ft/core). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DRILLDOWN_EVENT, type DrillDownRequest } from "../../data/drilldown.ts";
import { installCoreBackend, recurringFixture, recurringItem, renderWithToken } from "../../test/coreBackend.tsx";
import { RecurringWindow } from "./RecurringWindow.tsx";
import { LowBalanceWarnings, useLowBalanceWarnings } from "./warnings.tsx";

vi.mock("../../ui/Chart.tsx", () => import("../../test/chartStub.tsx"));

// The fixture's "today" is 2026-10-31; the UI reads the clock for the current month.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 31, 12));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function belowZeroFixture() {
  const f = recurringFixture();
  // Checking has $3,523.10; rent ($3,000) on Nov 1 then tuition ($900) on Nov 3 → $497.89 short before payday.
  f.data.recurringItems.push(recurringItem({ id: "r_tuition", merchantName: "Tuition", predictedNextDate: "2026-11-03", averageAmountCents: 90000, lastAmountCents: 90000 }));
  return f;
}

describe("Recurring: will I be covered?", () => {
  it("shows the upcoming view per paying account: balance, charges before the next income, lowest point and its basis", async () => {
    installCoreBackend(recurringFixture());
    renderWithToken(<RecurringWindow />);
    const table = await screen.findByRole("table", { name: "Coming out of Checking" });
    const rows = within(table).getAllByRole("row").slice(1).map((r) => r.textContent);
    expect(rows).toEqual([
      "Sun, Nov 1Rent -$3,000.00$523.10",
      "Tue, Nov 10City Power Estimate-$105.00$418.10",
      "Thu, Nov 12Streamly -$15.99$402.11",
      "Sun, Nov 15Acme Payroll Income+$2,500.00$2,902.11",
    ]);
    expect(screen.getByText("$3,523.10")).toBeTruthy();
    expect(screen.getAllByText("$402.11")[0]!.className).toContain("ui-stat__value"); // lowest point
    expect(screen.getAllByText(/Charges due before the next income \(Acme Payroll on 2026-11-15\)/)).toHaveLength(2); // the note and the basis list
    expect(screen.getByText("Starts from today's balance of $3,523.10.")).toBeTruthy();
    expect(screen.queryByTestId("low-balance-warning")).toBeNull();
  });

  it("warns at the top when the projection goes below zero: account, shortfall and date", async () => {
    installCoreBackend(belowZeroFixture());
    renderWithToken(<RecurringWindow />);
    const banner = await screen.findByTestId("low-balance-warning");
    expect(banner.textContent).toContain("Checking is projected to be $497.89 short on Nov 3, 2026");
    expect(banner.textContent).toContain("(lowest on Nov 12, 2026)");
    expect(screen.getByText("Below zero")).toBeTruthy();
  });

  it("exports the same warnings for the Overview (hook + banner)", async () => {
    installCoreBackend(belowZeroFixture());
    let fromHook: ReturnType<typeof useLowBalanceWarnings> | null = null;
    function Probe() {
      fromHook = useLowBalanceWarnings();
      return null;
    }
    const onOpen = vi.fn();
    renderWithToken(
      <>
        <Probe />
        <LowBalanceWarnings onOpen={onOpen} />
      </>,
    );
    await screen.findByTestId("low-balance-warning");
    expect(fromHook!.warnings).toEqual([expect.objectContaining({ accountId: "acc_checking", shortfallCents: 49789, date: "2026-11-03" })]);
    await userEvent.click(screen.getByRole("button", { name: "See what's coming" }));
    expect(onOpen).toHaveBeenCalled();
  });

  it("drills down from a projected charge to the past payments it is based on", async () => {
    const backend = installCoreBackend(recurringFixture());
    const seen: DrillDownRequest[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent<DrillDownRequest>).detail);
    window.addEventListener(DRILLDOWN_EVENT, listener);
    renderWithToken(<RecurringWindow />);
    await userEvent.click(await screen.findByRole("button", { name: "City Power" }));
    window.removeEventListener(DRILLDOWN_EVENT, listener);
    expect(seen).toEqual([{ query: "recurring.upcoming", params: {}, figureId: "occurrences.r_power", label: "Past City Power payments" }]);
    // The figure exists and totals the two past bills.
    const res = await (await fetch("http://x/q/recurring.upcoming", { method: "POST", body: "{}" })).json();
    expect(res.figures["occurrences.r_power"].cents).toBe(-21000);
    expect(backend.callsTo("recurring.upcoming").length).toBeGreaterThan(0);
  });
});

describe("Recurring: the list", () => {
  it("lists charges and income with how often, next date and account; estimates marked, new charges noted quietly", async () => {
    installCoreBackend(recurringFixture());
    renderWithToken(<RecurringWindow />);
    await userEvent.click(await screen.findByRole("tab", { name: "All recurring" }));
    const charges = await screen.findByRole("table", { name: "Charges and bills" });
    const text = within(charges).getAllByRole("row").slice(1).map((r) => r.textContent);
    expect(text[0]).toMatch(/^Rent.*\$3,000\.00Monthly.*Nov 1Checking/);
    expect(text[1]).toMatch(/^City Power Estimate.*≈ \$105\.00Monthly.*Nov 10Checking/);
    expect(text[2]).toMatch(/^Streamly New/);
    expect(screen.getByText(/New: Streamly\./)).toBeTruthy();
    expect(within(screen.getByRole("table", { name: "Income" })).getByText("Acme Payroll")).toBeTruthy();
  });

  it("adds a recurring charge after a preview, and the projection updates", async () => {
    const backend = installCoreBackend(recurringFixture());
    renderWithToken(<RecurringWindow />);
    await userEvent.click(await screen.findByRole("tab", { name: "All recurring" }));
    await userEvent.click(await screen.findByRole("button", { name: "Add recurring item" }));
    await userEvent.type(screen.getByLabelText("Name"), "Gym");
    await userEvent.type(screen.getByLabelText("Amount ($)"), "45");
    await userEvent.clear(screen.getByLabelText("Next date"));
    await userEvent.type(screen.getByLabelText("Next date"), "2026-11-05");
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(await screen.findByText('Add recurring charge "Gym"')).toBeTruthy();
    expect(screen.getByText("Gym · $45.00 monthly · next 2026-11-05 · Checking")).toBeTruthy();
    expect(backend.callsTo("recurring.add").map((c) => c.kind)).toEqual(["preview"]);
    await userEvent.click(screen.getByRole("button", { name: "Add it" }));
    await waitFor(() => expect(backend.data.recurringItems.some((i) => i.description === "Gym")).toBe(true));
    await userEvent.click(screen.getByRole("tab", { name: "Will I be covered?" }));
    const table = await screen.findByRole("table", { name: "Coming out of Checking" });
    await waitFor(() => expect(within(table).getByText("Gym")).toBeTruthy());
  });

  it("edits an item's amount after a preview, and the projection uses the new amount", async () => {
    const backend = installCoreBackend(recurringFixture());
    renderWithToken(<RecurringWindow />);
    await userEvent.click(await screen.findByRole("tab", { name: "All recurring" }));
    await userEvent.click(await screen.findByRole("button", { name: "Edit Rent" }));
    await userEvent.clear(screen.getByLabelText("Amount ($)"));
    await userEvent.type(screen.getByLabelText("Amount ($)"), "3100");
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    await userEvent.click(await screen.findByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(backend.data.recurringOverrides).toEqual([expect.objectContaining({ recurringItemId: "r_rent", amountCents: 310000 })]));
    await userEvent.click(screen.getByRole("tab", { name: "Will I be covered?" }));
    const table = await screen.findByRole("table", { name: "Coming out of Checking" });
    await waitFor(() => expect(within(table).getByText("-$3,100.00")).toBeTruthy());
  });

  it("shows the account a card is paid from even when no statement is due (recurring.cards)", async () => {
    const f = recurringFixture();
    // The last statement's due date has passed: nothing is due, but the card is still paid from Checking.
    f.data.liabilities = f.data.liabilities.map((l) => ({ ...l, nextPaymentDueDate: "2026-10-05" }));
    const backend = installCoreBackend(f);
    renderWithToken(<RecurringWindow />);
    await userEvent.click(await screen.findByRole("tab", { name: "All recurring" }));
    const picker = (await screen.findByLabelText(/is paid from$/)) as HTMLSelectElement;
    await waitFor(() => expect(picker.selectedOptions[0]!.textContent).toBe("Checking"));
    expect(screen.queryByText(/^Statement /)).toBeNull();
    expect(backend.callsTo("recurring.cards").length).toBeGreaterThan(0);
    // Choosing "Not set" previews the change from Checking.
    await userEvent.selectOptions(picker, "");
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(await screen.findByText(/Pay .* from no account/)).toBeTruthy();
  });

  it("removes an item through recurring.remove with a preview", async () => {
    const backend = installCoreBackend(recurringFixture());
    renderWithToken(<RecurringWindow />);
    await userEvent.click(await screen.findByRole("tab", { name: "All recurring" }));
    await userEvent.click(await screen.findByRole("button", { name: "Remove Streamly" }));
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(await screen.findByText('Remove recurring item "Streamly"')).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(backend.data.recurringOverrides).toEqual([expect.objectContaining({ recurringItemId: "r_stream", removed: true })]));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Remove Streamly" })).toBeNull());
  });
});

describe("Recurring: month calendar", () => {
  it("shows when each charge hits and the month's fixed-cost total with the estimated part", async () => {
    installCoreBackend(recurringFixture());
    renderWithToken(<RecurringWindow />);
    await userEvent.click(await screen.findByRole("tab", { name: "Month calendar" }));
    await userEvent.click(await screen.findByRole("button", { name: "Next month" }));
    expect(await screen.findByText("November 2026")).toBeTruthy();
    // Rent 3,000 + power ≈105 + streaming 15.99
    await waitFor(() => expect(screen.getByText("$3,120.99")).toBeTruthy());
    expect(screen.getByText("includes ≈ $105.00 of estimates")).toBeTruthy();
    expect(screen.getByTitle("City Power: $105.00 (estimate)")).toBeTruthy();
  });
});
