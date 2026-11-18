/**
 * The Overview's alerts strip (§13 "Only when there's something to deal
 * with"): a projected below-zero balance (§9), a bank needing reconnection
 * (§4), an "unexplained" reconciliation difference (§6), items in Needs a look
 * (§6). Empty when all is good, so a clean Overview means "all good".
 */
import type { ConnectionHealth } from "../../connections/api.ts";
import { needsAttention } from "../../connections/api.ts";

export interface BelowZeroWarning {
  accountId: string;
  accountName: string;
  shortfallCents: number;
  date: string;
  message: string;
}

export type AlertKind = "low-balance" | "reconnect" | "unexplained" | "needs-a-look";

export interface OverviewAlert {
  id: string;
  kind: AlertKind;
  text: string;
  /** Button label for the next step. */
  action: string;
  /** For "reconnect". */
  itemId?: string;
}

export interface AlertInputs {
  lowBalance?: readonly BelowZeroWarning[];
  connections?: readonly ConnectionHealth[];
  unexplainedCount?: number;
  needsALookCount?: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function computeAlerts(i: AlertInputs): OverviewAlert[] {
  const out: OverviewAlert[] = [];
  for (const c of i.connections ?? []) {
    if (!needsAttention(c)) continue;
    out.push({ id: `reconnect:${c.itemId}`, kind: "reconnect", text: c.message, action: "Reconnect", itemId: c.itemId });
  }
  for (const w of i.lowBalance ?? []) {
    out.push({ id: `low:${w.accountId}`, kind: "low-balance", text: w.message, action: "See what's due" });
  }
  if ((i.unexplainedCount ?? 0) > 0) {
    out.push({
      id: "unexplained",
      kind: "unexplained",
      text: `${plural(i.unexplainedCount!, "account has", "accounts have")} an unexplained difference this month`,
      action: "Review",
    });
  }
  if ((i.needsALookCount ?? 0) > 0) {
    out.push({ id: "needs-a-look", kind: "needs-a-look", text: `${plural(i.needsALookCount!, "item", "items")} in Needs a look`, action: "Review" });
  }
  return out;
}
