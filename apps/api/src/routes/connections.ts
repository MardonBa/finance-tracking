/**
 * Bank connections, sync and connection health (§3 backend, §4):
 *
 *   GET  /connections/limit        Plaid Trial usage, checked before opening Link
 *   POST /connections/link         start Hosted Link: {} for a new bank, {itemId} to reconnect (update mode)
 *   POST /connections/finalize     {sessionId} collect the result from Plaid and save the bank
 *   POST /connections/duplicate    {sessionId, choice: "keep" | "discard"} after a duplicate warning
 *   GET  /connections              health per bank: status, message, last updated, consent expiry, import status
 *   POST /refresh                  Refresh button: ask Plaid to check every bank now, then sync
 *   GET  /sync/review              transactions Plaid removed that still carry my edits or links
 */
import { Hono } from "hono";
import { z } from "zod";
import type { HonoEnv } from "../env.ts";
import { LinkError, createLinkSession, finalizeSession, resolveDuplicate, trialStatus } from "../connections/link.ts";
import { refreshAll } from "../sync/refresh.ts";
import { syncItem } from "../sync/run.ts";
import { messageFor, needsReconnect } from "../sync/status.ts";
import type { ItemStatus } from "@ft/core";
import { inBackground } from "./background.ts";

const linkBody = z.object({ itemId: z.string().min(1).max(100).optional() });
const sessionBody = z.object({ sessionId: z.string().min(1).max(100) });
const duplicateBody = sessionBody.extend({ choice: z.enum(["keep", "discard"]) });

async function body(req: Request): Promise<unknown> {
  const text = await req.text();
  return text.trim() ? JSON.parse(text) : {};
}

interface HealthRow {
  id: string;
  institution_name: string | null;
  status: ItemStatus;
  error_code: string | null;
  consent_expires_at: string | null;
  last_successful_update_at: string | null;
  last_synced_at: string | null;
  transactions_update_status: string | null;
  refresh_available_at: string | null;
  created_at: string;
  running: number;
  account_count: number;
}

export const connectionRoutes = new Hono<HonoEnv>()
  .get("/connections/limit", async (c) => c.json(await trialStatus(c.env)))
  .post("/connections/link", async (c) => {
    const { itemId } = linkBody.parse(await body(c.req.raw));
    try {
      return c.json(await createLinkSession(c.env, { itemId }));
    } catch (e) {
      if (e instanceof LinkError) return c.json({ error: e.code, message: e.message }, e.httpStatus);
      throw e;
    }
  })
  .post("/connections/finalize", async (c) => {
    const { sessionId } = sessionBody.parse(await body(c.req.raw));
    try {
      const { result, newItemId, repairedItemId } = await finalizeSession(c.env, sessionId);
      // First import of a new bank, or a resync of a bank just repaired in update mode.
      if (newItemId) await inBackground(c, () => syncItem(c.env, newItemId, { trigger: "initial" }));
      if (repairedItemId) await inBackground(c, () => syncItem(c.env, repairedItemId, { trigger: "manual" }));
      return c.json(result, result.status === "pending" || result.status === "finalizing" ? 202 : 200);
    } catch (e) {
      if (e instanceof LinkError) return c.json({ error: e.code, message: e.message }, e.httpStatus);
      throw e;
    }
  })
  .post("/connections/duplicate", async (c) => {
    const { sessionId, choice } = duplicateBody.parse(await body(c.req.raw));
    try {
      const { result, newItemId } = await resolveDuplicate(c.env, sessionId, choice);
      if (newItemId) await inBackground(c, () => syncItem(c.env, newItemId, { trigger: "initial" }));
      return c.json(result);
    } catch (e) {
      if (e instanceof LinkError) return c.json({ error: e.code, message: e.message }, e.httpStatus);
      throw e;
    }
  })
  .get("/connections", async (c) => {
    const rows = await c.env.DB.prepare(
      `SELECT i.id, i.institution_name, i.status, i.error_code, i.consent_expires_at, i.last_successful_update_at, i.last_synced_at,
              i.transactions_update_status, i.refresh_available_at, i.created_at,
              EXISTS (SELECT 1 FROM sync_runs r WHERE r.item_id = i.id AND r.status = 'running') AS running,
              (SELECT count(*) FROM accounts a WHERE a.item_id = i.id) AS account_count
       FROM plaid_items i ORDER BY i.created_at`,
    ).all<HealthRow>();
    const items = rows.results.map((r) => ({
      itemId: r.id,
      institutionName: r.institution_name,
      status: r.status,
      errorCode: r.error_code,
      message: messageFor(r.status, r.error_code, r.institution_name),
      needsReconnect: needsReconnect(r.status),
      // Plaid's last successful update; our own last sync time where Plaid gives none (decision 006).
      lastUpdatedAt: r.last_successful_update_at ?? r.last_synced_at,
      lastUpdatedSource: r.last_successful_update_at ? "plaid" : r.last_synced_at ? "sync" : null,
      consentExpiresAt: r.consent_expires_at,
      importStatus: r.transactions_update_status === "HISTORICAL_UPDATE_COMPLETE" ? "up_to_date" : "importing",
      syncing: r.running === 1,
      refreshAvailableAt: r.refresh_available_at,
      accountCount: r.account_count,
    }));
    return c.json({ items });
  })
  .post("/refresh", async (c) => c.json({ items: await refreshAll(c.env) }))
  .get("/sync/review", async (c) => {
    const rows = await c.env.DB.prepare(
      `SELECT t.id, t.account_id AS accountId, t.date, t.amount_cents AS amountCents, t.raw_description AS rawDescription, t.removed_at AS removedAt,
              EXISTS (SELECT 1 FROM transaction_overrides o WHERE o.transaction_id = t.id) AS hasOverride,
              (SELECT count(*) FROM splits s WHERE s.transaction_id = t.id) AS splitCount,
              (SELECT count(*) FROM transaction_tags g WHERE g.transaction_id = t.id) AS tagCount,
              (SELECT count(*) FROM transfer_links l WHERE l.needs_review = 1 AND t.id IN (l.out_transaction_id, l.in_transaction_id)) AS transferLinksToReview,
              (SELECT count(*) FROM refund_links l WHERE l.needs_review = 1 AND t.id IN (l.refund_transaction_id, l.purchase_transaction_id)) AS refundLinksToReview,
              EXISTS (SELECT 1 FROM goals g WHERE g.purchase_transaction_id = t.id) AS isGoalPurchase
       FROM transactions t
       WHERE t.removed = 1
       ORDER BY t.removed_at DESC`,
    ).all<Record<string, number | string>>();
    const items = rows.results.filter((r) => r.hasOverride || r.splitCount || r.tagCount || r.transferLinksToReview || r.refundLinksToReview || r.isGoalPurchase);
    return c.json({ items });
  });
