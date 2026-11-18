import type { Account, AccountKind } from "../types.ts";

/** The user-facing kind of an account: the user's fix if set, else from Plaid's type. */
export function accountKind(a: Pick<Account, "kindOverride" | "type" | "subtype" | "isManual">): AccountKind {
  if (a.kindOverride) return a.kindOverride;
  switch (a.type) {
    case "credit":
      return "credit";
    case "loan":
      return "loan";
    case "investment":
      return "investment";
    case "depository": {
      const sub = (a.subtype ?? "").toLowerCase();
      if (["savings", "money market", "cd", "hsa"].includes(sub)) return "savings";
      return "checking";
    }
    default:
      return a.isManual ? "cash" : "other";
  }
}

/** "Checking ••0000" style name, never the full account number. */
export function accountLabel(a: Pick<Account, "nickname" | "name" | "mask">): string {
  const name = a.nickname ?? a.name;
  return a.mask ? `${name} ••${a.mask}` : name;
}
