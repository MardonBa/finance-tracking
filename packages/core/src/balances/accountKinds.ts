/**
 * Account kinds and groups used by balances, goals, recurring and
 * trajectory. The kind is the user's override when set, else derived from
 * Plaid's type and subtype.
 */
import type { Cents } from "../money.ts";
import type { Account, AccountKind } from "../types.ts";

/** Groups for the "group by type" toggle on the net worth chart (§5). */
export const BALANCE_GROUPS = ["cash", "credit", "investments", "loans", "other"] as const;
export type BalanceGroup = (typeof BALANCE_GROUPS)[number];

export const BALANCE_GROUP_LABELS: Record<BalanceGroup, string> = {
  cash: "Cash",
  credit: "Credit",
  investments: "Investments",
  loans: "Loans",
  other: "Other",
};

const SAVINGS_SUBTYPES = ["savings", "money market", "cd", "hsa", "cash management"];

export function accountKind(account: Pick<Account, "kindOverride" | "type" | "subtype" | "isManual">): AccountKind {
  if (account.kindOverride) return account.kindOverride;
  switch (account.type) {
    case "credit":
      return "credit";
    case "loan":
      return "loan";
    case "investment":
      return "investment";
    case "depository": {
      const sub = (account.subtype ?? "").toLowerCase();
      return SAVINGS_SUBTYPES.includes(sub) ? "savings" : "checking";
    }
    default:
      return account.isManual ? "cash" : "other";
  }
}

export function groupOfKind(kind: AccountKind): BalanceGroup {
  switch (kind) {
    case "checking":
    case "savings":
    case "cash":
      return "cash";
    case "credit":
      return "credit";
    case "investment":
      return "investments";
    case "loan":
      return "loans";
    default:
      return "other";
  }
}

/** Credit cards and loans are debts: they count below zero in net worth. */
export function isDebtKind(kind: AccountKind): boolean {
  return kind === "credit" || kind === "loan";
}

/** Kinds whose past balances can be rebuilt from transactions (§5). */
export function isRebuildableKind(kind: AccountKind): boolean {
  return kind === "checking" || kind === "savings" || kind === "credit" || kind === "cash";
}

/** Kinds that pay bills and get an upcoming-charges projection (§9). */
export function isCashKind(kind: AccountKind): boolean {
  return kind === "checking" || kind === "savings" || kind === "cash";
}

/**
 * Convert a balance as Plaid reports it (debts owed are positive) into a
 * net-worth contribution (debts negative). Ingest uses this once.
 */
export function netWorthContributionFromPlaid(kind: AccountKind, plaidBalanceCents: Cents): Cents {
  if (!isDebtKind(kind)) return plaidBalanceCents;
  return plaidBalanceCents === 0 ? 0 : -plaidBalanceCents;
}

export function displayName(account: Pick<Account, "nickname" | "name">): string {
  return account.nickname ?? account.name;
}
