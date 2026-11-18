/**
 * Daily balance snapshots (§5 "the daily sync saves a snapshot"): today's
 * current balance (a net-worth contribution, debts negative) for every
 * account, upserted by account + date so re-running the cron is harmless.
 *
 * A balance not refreshed in the last 36 hours (e.g. the bank's sync failed)
 * is saved as carried forward and marked, never as fresh data.
 * Rebuilt history and the weekly downsampling after 90 days belong to
 * core-balances; they plug in through syncHooks.afterDailySnapshots.
 */
import { deps } from "../deps.ts";
import type { AppEnv } from "../env.ts";
import { syncHooks } from "./hooks.ts";

const STALE_AFTER_MS = 36 * 60 * 60 * 1000;

export async function saveDailySnapshots(env: AppEnv, today: string): Promise<{ saved: number }> {
  const staleBefore = new Date(deps.now() - STALE_AFTER_MS).toISOString();
  await env.DB.prepare(
    `INSERT INTO balance_snapshots (account_id, date, balance_cents, source, is_estimated, is_carried_forward)
     SELECT id, ?1, current_balance_cents,
            CASE WHEN is_manual = 1 THEN 'manual'
                 WHEN balance_updated_at IS NULL OR balance_updated_at < ?2 THEN 'carried_forward'
                 ELSE 'plaid' END,
            0,
            CASE WHEN is_manual = 0 AND (balance_updated_at IS NULL OR balance_updated_at < ?2) THEN 1 ELSE 0 END
     FROM accounts WHERE current_balance_cents IS NOT NULL
     ON CONFLICT (account_id, date) DO UPDATE SET
       balance_cents = excluded.balance_cents, source = excluded.source,
       is_estimated = 0, is_carried_forward = excluded.is_carried_forward`,
  )
    .bind(today, staleBefore)
    .run();
  const ids = await env.DB.prepare("SELECT account_id FROM balance_snapshots WHERE date = ?1").bind(today).all<{ account_id: string }>();
  await syncHooks.afterDailySnapshots(env, { date: today, accountIds: ids.results.map((r) => r.account_id) });
  // Count the snapshots themselves: meta.changes also counts the slice-version trigger updates (migration 0004).
  return { saved: ids.results.length };
}
