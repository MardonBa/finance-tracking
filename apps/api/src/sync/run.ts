/**
 * Orchestrates syncing items (§4): the per-item lock, item status, and which
 * products to fetch. One item failing never stops the others.
 */
import { eq, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { plaidItems, syncRuns } from "../db/schema.ts";
import { deps, newId, nowIso, plaidFor } from "../deps.ts";
import { PlaidApiError, trimItem, type PlaidClient } from "../plaid/index.ts";
import type { AppEnv } from "../env.ts";
import { todayFor } from "../routes/registry.ts";
import { accessTokenFor, loadItem, type ItemRow } from "./accounts.ts";
import { syncHooks } from "./hooks.ts";
import { syncInvestments, syncLiabilities, syncLiveBalances, syncRecurring } from "./products.ts";
import { consentExpiringSoon, isTransient, messageFor, statusForError } from "./status.ts";
import { syncTransactions } from "./transactions.ts";

export type SyncTrigger = "cron" | "webhook" | "manual" | "initial";
export type SyncScope = "all" | "transactions" | "investments" | "liabilities" | "recurring";

export type ItemSyncOutcome =
  | { itemId: string; status: "up_to_date"; added: number; modified: number; removed: number }
  | { itemId: string; status: "already_running" }
  | { itemId: string; status: "error"; errorCode: string; message: string };

/** A running sync older than this is assumed dead (Worker evicted) and its lock is ignored. */
const LOCK_TTL_MS = 15 * 60 * 1000;

/**
 * Take the per-item lock by inserting a "running" sync_runs row, atomically,
 * only if no other fresh run is in progress for the item. Returns the run id,
 * or null when another run holds the lock.
 */
export async function acquireSyncLock(env: AppEnv, itemId: string, trigger: SyncTrigger): Promise<string | null> {
  const id = newId("run");
  const now = deps.now();
  const res = await env.DB.prepare(
    `INSERT INTO sync_runs (id, item_id, "trigger", started_at, status, added_count, modified_count, removed_count)
     SELECT ?1, ?2, ?3, ?4, 'running', 0, 0, 0
     WHERE NOT EXISTS (SELECT 1 FROM sync_runs WHERE item_id = ?2 AND status = 'running' AND started_at > ?5)`,
  )
    .bind(id, itemId, trigger, new Date(now).toISOString(), new Date(now - LOCK_TTL_MS).toISOString())
    .run();
  return (res.meta.changes ?? 0) === 1 ? id : null;
}

async function finishRun(env: AppEnv, runId: string, status: "ok" | "error", counts: { added: number; modified: number; removed: number }, errorCode: string | null) {
  await drizzle(env.DB)
    .update(syncRuns)
    .set({ status, finishedAt: nowIso(), errorCode, addedCount: counts.added, modifiedCount: counts.modified, removedCount: counts.removed })
    .where(eq(syncRuns.id, runId));
}

/** /item/get → institution, consent expiry, Plaid's last successful update, error state. */
export async function refreshItemStatus(env: AppEnv, plaid: PlaidClient, item: ItemRow, accessToken: string) {
  const got = await plaid.call("/item/get", { access_token: accessToken });
  const t = trimItem(got);
  let status = item.status;
  let errorCode = item.errorCode;
  if (t.errorCode) {
    status = statusForError(t.errorCode);
    errorCode = t.errorCode;
  } else if (consentExpiringSoon(t.consentExpiresAt, deps.now())) {
    status = "pending_expiration";
    errorCode = "PENDING_EXPIRATION";
  } else if (item.status === "pending_expiration" && item.errorCode === "PENDING_DISCONNECT") {
    // Set by the PENDING_DISCONNECT webhook; item/get does not report it. Cleared by update mode.
  } else {
    status = "ok";
    errorCode = null;
  }
  await drizzle(env.DB)
    .update(plaidItems)
    .set({
      status,
      errorCode,
      institutionId: t.institutionId ?? item.institutionId,
      institutionName: t.institutionName ?? item.institutionName,
      consentExpiresAt: t.consentExpiresAt,
      lastSuccessfulUpdateAt: t.lastSuccessfulUpdateAt ?? item.lastSuccessfulUpdateAt,
    })
    .where(eq(plaidItems.id, item.id));
  return { products: new Set(got.item.products ?? []), status, errorCode };
}

/** Record an error from Plaid on the item (status + code). Transient errors don't change the status. */
export async function recordItemError(env: AppEnv, itemId: string, code: string) {
  if (isTransient(code)) return;
  await drizzle(env.DB).update(plaidItems).set({ status: statusForError(code), errorCode: code }).where(eq(plaidItems.id, itemId));
}

export function errorCodeOf(e: unknown): string {
  if (e instanceof PlaidApiError) return e.errorCode ?? `HTTP_${e.status}`;
  return "INTERNAL_ERROR";
}

/**
 * Sync one item under its lock. `scope` limits the work for webhooks (e.g.
 * only investments after HOLDINGS: DEFAULT_UPDATE). Never throws: errors are
 * recorded on the item and the sync run, and returned.
 */
export async function syncItem(
  env: AppEnv,
  itemId: string,
  opts: { trigger: SyncTrigger; scope?: SyncScope; liveBalances?: boolean } = { trigger: "manual" },
): Promise<ItemSyncOutcome> {
  const scope = opts.scope ?? "all";
  const runId = await acquireSyncLock(env, itemId, opts.trigger);
  if (!runId) return { itemId, status: "already_running" };
  const counts = { added: 0, modified: 0, removed: 0 };
  try {
    const item = await loadItem(env, itemId);
    if (!item) throw new Error(`No item ${itemId}`);
    const plaid = plaidFor(env);
    const accessToken = await accessTokenFor(env, item);
    const today = todayFor(env, deps.now());
    const now = nowIso();
    const { products } = await refreshItemStatus(env, plaid, item, accessToken);

    if (opts.liveBalances) await syncLiveBalances(env, plaid, itemId, accessToken, today, now);
    if (scope === "all" || scope === "transactions") {
      const r = await syncTransactions(env, plaid, itemId, accessToken, item.transactionsCursor, today, now);
      Object.assign(counts, { added: r.added, modified: r.modified, removed: r.removed });
      await syncHooks.afterTransactionsSynced(env, { itemId, changedIds: r.changedIds, removedIds: r.removedIds });
    }
    if ((scope === "all" || scope === "investments") && products.has("investments")) await syncInvestments(env, plaid, itemId, accessToken, today, now);
    if ((scope === "all" || scope === "liabilities") && products.has("liabilities")) await syncLiabilities(env, plaid, itemId, accessToken, today, now);
    if (scope === "all" || scope === "recurring") await syncRecurring(env, plaid, itemId, accessToken, today);

    await drizzle(env.DB).update(plaidItems).set({ lastSyncedAt: nowIso() }).where(eq(plaidItems.id, itemId));
    await finishRun(env, runId, "ok", counts, null);
    return { itemId, status: "up_to_date", ...counts };
  } catch (e) {
    const code = errorCodeOf(e);
    if (!(e instanceof PlaidApiError)) console.error(`sync ${itemId} failed:`, e instanceof Error ? e.message : e);
    await recordItemError(env, itemId, code).catch(() => {});
    await finishRun(env, runId, "error", counts, code).catch(() => {});
    const item = await loadItem(env, itemId).catch(() => undefined);
    return { itemId, status: "error", errorCode: code, message: messageFor(item?.status ?? "error", code, item?.institutionName ?? null) };
  }
}

/** Every connected item that can still be synced (revoked ones need a reconnect first). */
export async function syncableItemIds(env: AppEnv): Promise<string[]> {
  const rows = await drizzle(env.DB).select({ id: plaidItems.id }).from(plaidItems).where(ne(plaidItems.status, "revoked")).all();
  return rows.map((r) => r.id);
}

/** Sync every item one after another; one failure doesn't stop the rest. */
export async function syncAllItems(env: AppEnv, trigger: SyncTrigger): Promise<ItemSyncOutcome[]> {
  const out: ItemSyncOutcome[] = [];
  for (const id of await syncableItemIds(env)) out.push(await syncItem(env, id, { trigger }));
  return out;
}
