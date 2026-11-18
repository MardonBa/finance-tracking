/**
 * Seams for logic owned by the @ft/core tracks. Sync stores raw, trimmed Plaid
 * data correctly on its own; these hooks let classification (core-flows) and
 * snapshot rebuild/downsampling (core-balances) run on top later without
 * changing the sync code. Each is a no-op until wired up.
 */
import type { AppEnv } from "../env.ts";

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
  async afterDailySnapshots() {},
};
