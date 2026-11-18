import type { IsoDate } from "../dates.ts";
import type { Transaction } from "../types.ts";

/**
 * The date a transaction counts on (§1, decision 005): the purchase date
 * (Plaid's authorized_date) when present, otherwise the posted date. Dates are
 * the calendar dates Plaid reports for the account, so no time zone shift is
 * ever applied here; "today" is computed in the user's zone at the edge.
 */
export function effectiveDate(t: Pick<Transaction, "authorizedDate" | "date">): IsoDate {
  return t.authorizedDate ?? t.date;
}
