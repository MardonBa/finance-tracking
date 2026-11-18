/**
 * Seams for logic owned by the @ft/core tracks. Sync stores raw, trimmed Plaid
 * data correctly on its own; these hooks let classification (core-flows) and
 * snapshot rebuild/downsampling (core-balances) run on top without changing
 * the sync code.
 *
 * - afterDailySnapshots: rebuild estimated history for newly connected
 *   accounts, manual balances/snapshots from their transactions, weekly
 *   downsampling after 90 days (sync/balanceMaintenance.ts).
 * - afterTransactionsSynced: deliberately a no-op. Categories, buckets,
 *   transfer and refund matches are computed by core at query time from the
 *   raw transactions plus the user's overrides, rules and confirmed links
 *   (flows/ledger.ts), so nothing derived needs persisting after a sync, and
 *   a changed rule or a pending -> posted swap never leaves stale stored
 *   classifications behind. Only user decisions are stored (by actions).
 */
import type { AppEnv } from "../env.ts";
import { maintainSnapshots } from "./balanceMaintenance.ts";

export interface TransactionsSyncedEvent {
  itemId: string;
  /** Our transaction ids that were inserted or changed (including pending → posted replacements). */
  changedIds: string[];
  /** Our transaction ids Plaid removed (kept, flagged; see sync/transactions.ts). */
  removedIds: string[];
}

export interface SnapshotsSavedEvent {
  /** The user's "today" the snapshots were saved for. */
  date: string;
  accountIds: string[];
}

export interface SyncHooks {
  /** e.g. classify new transactions, match transfers/refunds (core-flows). */
  afterTransactionsSynced(env: AppEnv, event: TransactionsSyncedEvent): Promise<void>;
  /** e.g. rebuild estimated history for new accounts, downsample old snapshots (core-balances). */
  afterDailySnapshots(env: AppEnv, event: SnapshotsSavedEvent): Promise<void>;
}

export const syncHooks: SyncHooks = {
  async afterTransactionsSynced() {},
  async afterDailySnapshots(env, event) {
    const r = await maintainSnapshots(env, event.date);
    if (r.upserted || r.deleted || r.balancesFixed) {
      console.log(`snapshots ${event.date}: ${r.upserted} written, ${r.deleted} downsampled away, ${r.balancesFixed} manual balances fixed, rebuilt ${r.rebuilt.length} account(s)`);
    }
  },
};
