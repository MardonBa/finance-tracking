/**
 * Plaid personal-finance categories (PFC v2): which ones mean "transfer",
 * "income" and so on, and how a detailed category maps to its broad one.
 * Categories are stored as Plaid's strings ("FOOD_AND_DRINK_COFFEE"); a
 * user-chosen category may be a detailed or a primary string.
 */

/** Plaid's primary (broad) categories. */
export const PLAID_PRIMARY_CATEGORIES = [
  "INCOME",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "LOAN_PAYMENTS",
  "BANK_FEES",
  "ENTERTAINMENT",
  "FOOD_AND_DRINK",
  "GENERAL_MERCHANDISE",
  "HOME_IMPROVEMENT",
  "MEDICAL",
  "PERSONAL_CARE",
  "GENERAL_SERVICES",
  "GOVERNMENT_AND_NON_PROFIT",
  "TRANSPORTATION",
  "TRAVEL",
  "RENT_AND_UTILITIES",
  "OTHER",
] as const;

/** Shown when nothing (override, rule, split, Plaid) gives a category. */
export const UNCATEGORIZED = "UNCATEGORIZED";

/** The broad category of a detailed one ("FOOD_AND_DRINK_COFFEE" → "FOOD_AND_DRINK"). */
export function primaryOf(category: string): string {
  // Longest prefix wins so "TRANSFER_IN_…" is not read as a shorter primary.
  let best: string | null = null;
  for (const p of PLAID_PRIMARY_CATEGORIES) {
    if ((category === p || category.startsWith(`${p}_`)) && (best === null || p.length > best.length)) best = p;
  }
  return best ?? category;
}

/** Plaid labels this movement as a transfer (incl. credit card payments). */
export function isPlaidTransferCategory(primary: string | null, detailed: string | null): boolean {
  if (primary === "TRANSFER_IN" || primary === "TRANSFER_OUT") return true;
  return detailed === "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";
}

export function isCardPaymentCategory(detailed: string | null): boolean {
  return detailed === "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";
}

/** Plaid's income categories (wages, interest, dividends, …). */
export function isPlaidIncomeCategory(primary: string | null, detailed: string | null): boolean {
  return primary === "INCOME" || (detailed ?? "").startsWith("INCOME_");
}

/** Readable label: "FOOD_AND_DRINK_COFFEE" → "Food and drink coffee". */
export function categoryLabel(category: string): string {
  if (category === UNCATEGORIZED) return "Uncategorised";
  const words = category.toLowerCase().split("_").filter(Boolean);
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
