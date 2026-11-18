/**
 * After the daily snapshots are saved (syncHooks.afterDailySnapshots): apply
 * core-balances' snapshot upkeep (packages/core/src/balances/maintenance.ts):
 * rebuild estimated history for newly connected depository/credit accounts,
 * keep manual accounts' balances and snapshots equal to their transactions,
 * and downsample snapshots older than 90 days to weekly.
 *
 * Everything is written in one D1 batch, so a failure leaves the day's
 * snapshots as they were (the next run tries again).
 */
import { Balances, type AccountId } from "@ft/core";
import { balanceSnapshots } from "../db/schema.ts";
import { bulkUpsert, chunkJson } from "../db/bulk.ts";
import { getDb, loadSlices } from "../db/data.ts";
import type { AppEnv } from "../env.ts";

export interface MaintenanceResult {
  upserted: number;
  deleted: number;
  balancesFixed: number;
  rebuilt: AccountId[];
}

export async function maintainSnapshots(env: AppEnv, today: string): Promise<MaintenanceResult> {
  const data = await loadSlices(getDb(env.DB), ["accounts", "transactions", "balanceSnapshots"]);
  // The history import is complete once Plaid's HISTORICAL_UPDATE_COMPLETE arrived for the account's bank.
  const complete = await env.DB.prepare("SELECT id FROM plaid_items WHERE transactions_update_status = 'HISTORICAL_UPDATE_COMPLETE'").all<{ id: string }>();
  const completeItems = new Set(complete.results.map((r) => r.id));
  const plan = Balances.planSnapshotMaintenance({
    accounts: data.accounts,
    transactions: data.transactions,
    snapshots: data.balanceSnapshots,
    today,
    historyCompleteAccountIds: new Set(data.accounts.filter((a) => a.itemId && completeItems.has(a.itemId)).map((a) => a.id)),
  });

  const statements: D1PreparedStatement[] = [];
  for (const json of chunkJson(plan.deletes)) {
    statements.push(
      env.DB.prepare(
        `DELETE FROM balance_snapshots WHERE EXISTS (
           SELECT 1 FROM json_each(?1) j
           WHERE json_extract(j.value, '$.accountId') = balance_snapshots.account_id AND json_extract(j.value, '$.date') = balance_snapshots.date)`,
      ).bind(json),
    );
  }
  statements.push(
    ...bulkUpsert(env.DB, balanceSnapshots, plan.upserts.map((s) => ({ ...s })), {
      conflict: ["accountId", "date"],
      update: ["balanceCents", "source", "isEstimated", "isCarriedForward"],
    }),
  );
  for (const b of plan.balances) {
    statements.push(env.DB.prepare("UPDATE accounts SET current_balance_cents = ?1 WHERE id = ?2 AND is_manual = 1").bind(b.currentBalanceCents, b.accountId));
  }
  if (statements.length > 0) await env.DB.batch(statements);
  return { upserted: plan.upserts.length, deleted: plan.deletes.length, balancesFixed: plan.balances.length, rebuilt: plan.rebuilt };
}
