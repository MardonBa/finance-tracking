/**
 * §6 "Tests cover each case above with Sandbox data and hand-built examples":
 * the saved Plaid Sandbox responses, trimmed exactly as sync stores them, run
 * through the same core ledger the app uses. (The hand-built cases are in
 * packages/core/test/flows.)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyData, queryRegistry, type Account, type CoreData, type Transaction } from "@ft/core";
import { RESPONSE_SCHEMAS } from "../../src/plaid/schemas.ts";
import { trimAccount, trimTransaction } from "../../src/plaid/trim.ts";

const DIR = join(import.meta.dirname, "../fixtures/plaid/sandbox/everyday-bank");
const load = (f: string) => JSON.parse(readFileSync(join(DIR, f), "utf8")) as unknown;

function sandboxData(): CoreData {
  const accounts = RESPONSE_SCHEMAS["/accounts/get"].parse(load("accounts_get.json")) as { accounts: Parameters<typeof trimAccount>[0][] };
  const sync = RESPONSE_SCHEMAS["/transactions/sync"].parse(load("transactions_sync.json")) as { added: Parameters<typeof trimTransaction>[0][] };
  const data = emptyData();
  data.accounts = accounts.accounts.map((a): Account => ({
    ...trimAccount(a, "2026-11-01T00:00:00.000Z"),
    id: a.account_id,
    itemId: "item_sandbox",
    nickname: null,
    kindOverride: null,
    isManual: false,
    hidden: false,
    protectedAmountCents: 0,
    incomeFallback: false,
    connectedOn: "2026-01-01",
    createdAt: "2026-01-01T00:00:00.000Z",
  }));
  data.transactions = sync.added.map((t): Transaction => {
    const { plaidAccountId, ...rest } = trimTransaction(t);
    return { ...rest, id: t.transaction_id, accountId: plaidAccountId, isManual: false, removed: false, removedAt: null, createdAt: `${t.date}T00:00:00.000Z`, updatedAt: `${t.date}T00:00:00.000Z` };
  });
  return data;
}

describe("Sandbox data through the core ledger (§6)", () => {
  const data = sandboxData();
  const dates = data.transactions.map((t) => t.date).sort();
  const q = queryRegistry.get("flows.buckets")!;
  const run = q.run(data as never, q.params.parse({ from: dates[0], to: dates.at(-1) }), dates.at(-1)!) as {
    value: { transactions: { transactionId: string; bucket: string }[] };
  };
  const bucketOf = (raw: RegExp) => {
    const ids = data.transactions.filter((t) => raw.test(t.rawDescription)).map((t) => t.id);
    expect(ids.length, String(raw)).toBeGreaterThan(0);
    return [...new Set(run.value.transactions.filter((t) => ids.includes(t.transactionId)).map((t) => t.bucket))];
  };

  it("every Sandbox transaction lands in exactly one bucket", () => {
    const ids = run.value.transactions.map((t) => t.transactionId);
    expect(new Set(ids).size).toBe(ids.length);
    // Pending charges are shown but not counted until they post (decision 005).
    expect(ids.sort()).toEqual(data.transactions.filter((t) => !t.removed && !t.pending).map((t) => t.id).sort());
  });

  it("paying the credit card from checking is a transfer on both sides", () => {
    expect(bucketOf(/PAYMENT TO EVERYDAY CREDIT CAR|PAYMENT THANK YOU/)).toEqual(["transfer"]);
  });

  it("checking → savings is a transfer on both sides", () => {
    expect(bucketOf(/ONLINE TRANSFER (TO SAV|FROM CHK)/)).toEqual(["transfer"]);
  });

  it("interest and paychecks are income", () => {
    expect(bucketOf(/INTEREST PAYMENT/)).toEqual(["income"]);
    expect(bucketOf(/PAYROLL/)).toEqual(["income"]);
  });

  it("a refund is not income", () => {
    expect(bucketOf(/REFUND/)).not.toContain("income");
  });
});
