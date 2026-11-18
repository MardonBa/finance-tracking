// @vitest-environment jsdom
/**
 * Manual accounts (§3) through the registry actions, against REAL core
 * outputs: add an account with a starting balance, then add / edit / delete
 * its transactions (amount, date, description, category, note); every change
 * is confirmed before → after and the balance follows the transactions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { basicFixture } from "@ft/core/fixtures";
import { calls, coreData, resetCore } from "../test/coreBackend.tsx";
import { renderInWindow } from "../test/render.tsx";
import { ManualAccountForm, ManualTransactions, manualTransactionSteps, parseDollars } from "./manual.tsx";
import { AccountEditor, accountEditSteps } from "./AccountEditor.tsx";

vi.mock("../api/client.ts", async () => (await import("../test/coreBackend.tsx")).clientMock);

beforeEach(() => resetCore(basicFixture().data));
afterEach(() => cleanup());

const balanceOf = (id: string) => coreData().accounts.find((a) => a.id === id)!.currentBalanceCents;
const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
async function confirm(label: string) {
  const card = await screen.findByRole("dialog", { name: /./ });
  await waitFor(() => expect(within(card).getByRole("button", { name: label }).hasAttribute("disabled")).toBe(false));
  fireEvent.click(within(card).getByRole("button", { name: label }));
}

describe("pure helpers", () => {
  it("parses dollar amounts and builds only the steps that changed", () => {
    expect(parseDollars("$1,200.50")).toBe(120050);
    expect(parseDollars("abc")).toBeNull();
    const draft = { id: null, direction: "out" as const, amount: "12.50", date: "2026-10-20", description: "Market", category: "FOOD_AND_DRINK", note: "" };
    expect(manualTransactionSteps("acc_cash", draft)).toEqual([
      { name: "accounts.addManualTransaction", input: { accountId: "acc_cash", amountCents: -1250, date: "2026-10-20", description: "Market", category: "FOOD_AND_DRINK", note: null } },
    ]);
    const before = { amountCents: -1250, date: "2026-10-20", rawDescription: "Market", category: "FOOD_AND_DRINK", note: null };
    expect(manualTransactionSteps("acc_cash", { ...draft, id: "tx_1" }, before)).toBe("Nothing changed.");
    expect(manualTransactionSteps("acc_cash", { ...draft, id: "tx_1", note: "Peaches" }, before)).toEqual([{ name: "transactions.setNote", input: { transactionId: "tx_1", note: "Peaches" } }]);
    expect(manualTransactionSteps("acc_cash", { ...draft, amount: "0" })).toBe("Enter an amount, e.g. 12.50.");
    expect(accountEditSteps("a", { name: "A", kind: "checking", hidden: false }, { name: "B", kind: "savings", hidden: true }).map((s) => s.name)).toEqual([
      "accounts.rename",
      "accounts.retype",
      "accounts.setHidden",
    ]);
  });
});

describe("manual account CRUD", { timeout: 30_000 }, () => {
  it("adds a manual account with a starting balance (confirmed first)", async () => {
    const created = vi.fn();
    renderInWindow(<ManualAccountForm onCreated={created} />, "overview");
    fireEvent.change(field("Name"), { target: { value: "Wallet" } });
    fireEvent.change(field("Starting balance ($)"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: /Add manual account/ }));
    await confirm("Add account");
    await waitFor(() => expect(created).toHaveBeenCalledWith("Wallet"));
    const wallet = coreData().accounts.find((a) => a.name === "Wallet")!;
    expect(wallet).toMatchObject({ isManual: true, currentBalanceCents: 4000 });
  });

  it("adds, edits and deletes a transaction with category and note; the balance follows", async () => {
    const start = balanceOf("acc_cash")!;
    renderInWindow(<ManualTransactions accountId="acc_cash" />, "overview");
    await screen.findByRole("button", { name: "Edit ATM cash" });

    // Add
    fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));
    fireEvent.change(field("Amount ($)"), { target: { value: "12.50" } });
    fireEvent.change(field("Description"), { target: { value: "Farmers market" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "FOOD_AND_DRINK" } });
    fireEvent.change(field("Note"), { target: { value: "Peaches" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await confirm("Add");
    await screen.findByRole("button", { name: "Edit Farmers market" });
    expect(balanceOf("acc_cash")).toBe(start - 1250);
    const added = coreData().transactions.find((t) => t.rawDescription === "Farmers market")!;
    expect(coreData().overrides.find((o) => o.transactionId === added.id)).toMatchObject({ category: "FOOD_AND_DRINK", note: "Peaches" });

    // Edit the amount
    fireEvent.click(screen.getByRole("button", { name: "Edit Farmers market" }));
    fireEvent.change(field("Amount ($)"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await confirm("Save");
    await waitFor(() => expect(balanceOf("acc_cash")).toBe(start - 2000));

    // Delete
    fireEvent.click(screen.getByRole("button", { name: "Delete Farmers market" }));
    await confirm("Delete");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Edit Farmers market" })).toBeNull());
    expect(balanceOf("acc_cash")).toBe(start);
    expect(calls.filter((c) => c.kind === "action").map((c) => c.name)).toEqual([
      "accounts.addManualTransaction",
      "accounts.editManualTransaction",
      "accounts.deleteManualTransaction",
    ]);
  });

  it("renames, retypes and hides an account through confirmed actions", async () => {
    renderInWindow(<AccountEditor account={{ id: "acc_checking", name: "Checking", mask: "0101", kind: "checking", hidden: false, balanceCents: null }} />, "overview");
    fireEvent.change(field("Name (••0101)"), { target: { value: "Everyday" } });
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "savings" } });
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await confirm("Save");
    await waitFor(() => expect(coreData().accounts.find((a) => a.id === "acc_checking")).toMatchObject({ nickname: "Everyday", kindOverride: "savings", hidden: true }));
  });
});
