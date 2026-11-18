/**
 * Manual Refresh (§4): ask Plaid to check each bank right now
 * (/transactions/refresh, /investments/refresh, live /accounts/balance/get),
 * then sync, and report per item "up_to_date" or the specific error. If Plaid
 * rate-limits refresh, the result says when it is next available.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { plaidItems } from "../db/schema.ts";
import { deps, plaidFor } from "../deps.ts";
import { PlaidApiError } from "../plaid/index.ts";
import type { AppEnv } from "../env.ts";
import { accessTokenFor, loadItem } from "./accounts.ts";
import { errorCodeOf, recordItemError, syncItem, syncableItemIds } from "./run.ts";
import { messageFor } from "./status.ts";

/** How long to wait after Plaid rate-limits a refresh. TODO(revisit): Plaid gives no retry time; 1 hour assumed (§4 Open). */
export const REFRESH_BACKOFF_MS = 60 * 60 * 1000;

export interface RefreshOutcome {
  itemId: string;
  institutionName: string | null;
  status: "up_to_date" | "rate_limited" | "already_running" | "error";
  errorCode?: string;
  message?: string;
  /** When Refresh may ask Plaid again (only when rate limited). */
  refreshAvailableAt?: string;
}

function isRateLimit(e: unknown): boolean {
  return e instanceof PlaidApiError && (e.errorType === "RATE_LIMIT_EXCEEDED" || e.status === 429);
}

export async function refreshItem(env: AppEnv, itemId: string): Promise<RefreshOutcome> {
  const item = await loadItem(env, itemId);
  if (!item) return { itemId, institutionName: null, status: "error", errorCode: "ITEM_NOT_FOUND", message: "Unknown connection" };
  const base = { itemId, institutionName: item.institutionName };
  const plaid = plaidFor(env);
  let rateLimitedUntil: string | null = item.refreshAvailableAt && Date.parse(item.refreshAvailableAt) > deps.now() ? item.refreshAvailableAt : null;

  if (!rateLimitedUntil) {
    try {
      const accessToken = await accessTokenFor(env, item);
      const got = await plaid.call("/item/get", { access_token: accessToken });
      const products = new Set(got.item.products ?? []);
      await plaid.call("/transactions/refresh", { access_token: accessToken });
      if (products.has("investments")) await plaid.call("/investments/refresh", { access_token: accessToken });
    } catch (e) {
      if (isRateLimit(e)) {
        rateLimitedUntil = new Date(deps.now() + REFRESH_BACKOFF_MS).toISOString();
        await drizzle(env.DB).update(plaidItems).set({ refreshAvailableAt: rateLimitedUntil }).where(eq(plaidItems.id, itemId));
      } else {
        const code = errorCodeOf(e);
        await recordItemError(env, itemId, code);
        const after = await loadItem(env, itemId);
        return { ...base, status: "error", errorCode: code, message: messageFor(after?.status ?? "error", code, item.institutionName) };
      }
    }
  }

  // Sync whatever Plaid has now; live balances only when Plaid let us refresh.
  const synced = await syncItem(env, itemId, { trigger: "manual", liveBalances: !rateLimitedUntil });
  if (synced.status === "error") return { ...base, status: "error", errorCode: synced.errorCode, message: synced.message };
  if (synced.status === "already_running") return { ...base, status: "already_running" };
  if (rateLimitedUntil) return { ...base, status: "rate_limited", refreshAvailableAt: rateLimitedUntil, message: "Synced; Plaid allows another refresh later" };
  return { ...base, status: "up_to_date" };
}

export async function refreshAll(env: AppEnv): Promise<RefreshOutcome[]> {
  const out: RefreshOutcome[] = [];
  for (const id of await syncableItemIds(env)) out.push(await refreshItem(env, id));
  return out;
}
