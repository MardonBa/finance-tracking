import { account, txn } from "../../fixtures/flows.ts";
import { emptyData, type CoreData, type Transaction } from "../../src/types.ts";
import type { ActionContext } from "../../src/registry.ts";

export { account, txn };

/** Small hand-built data: checking, HYSA, card, brokerage and cash plus the given rows. */
export function mini(transactions: Transaction[], extra: Partial<CoreData> = {}): CoreData {
  return {
    ...emptyData(),
    accounts: [
      account("chk", "depository", "checking", { nickname: "Checking" }),
      account("hysa", "depository", "savings", { nickname: "HYSA" }),
      account("card", "credit", "credit card", { nickname: "Card" }),
      account("brok", "investment", "brokerage", { nickname: "Brokerage" }),
      account("cash", "other", null, { name: "Cash", isManual: true, kindOverride: "cash" }),
    ],
    transactions,
    ...extra,
  };
}

export function ctx(today = "2026-10-20"): ActionContext {
  let n = 0;
  return { today, now: `${today}T12:00:00.000Z`, newId: () => `new_${++n}` };
}
