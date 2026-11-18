/** Display formatting shared by the Transactions and Spending windows. */
import { Money } from "@ft/core";

/** "$1,234.56" */
export const money = (c: number): string => Money.format(c);
/** "$1,235" for big numbers, cents kept under $1,000. */
export const moneyShort = (c: number): string => (Math.abs(c) >= 100_000 ? Money.format(c, { noCents: true }) : Money.format(c));
/** "+$12.00" / "-$12.00" */
export const signed = (c: number): string => Money.format(c, { showPlus: true });
/** "24%" or "—" */
export const pct = (r: number | null): string => (r === null ? "—" : `${Math.round(r * 100)}%`);
/** "+5 pts" */
export const points = (p: number | null): string => (p === null ? "—" : `${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(Math.round(p * 100))} pts`);
