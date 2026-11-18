/**
 * /transactions/sync for one item (§4).
 *
 * Safe to repeat:
 *  - each page is applied in ONE D1 batch together with its next_cursor, so a
 *    crash leaves the cursor at the last fully applied page;
 *  - rows are upserted by plaid_transaction_id, so replaying a page (or a
 *    whole sync) changes nothing;
 *  - overlapping runs for the same item are prevented by the sync_runs lock
 *    (sync/run.ts).
 *
 * Pending → posted: Plaid removes the pending transaction and adds the posted
 * one with pending_transaction_id pointing at it. We REUSE the pending row
 * (same id) for the posted transaction, so every edit keyed by our id
 * (overrides, notes, tags, splits, transfer/refund links, goal purchase links,
 * recurring links) carries over without copying. Works whichever order the
 * two events arrive in, including across pages and syncs.
 *
 * Removed: the row is kept with removed = 1 and removed_at; transfer and
 * refund links touching it get needs_review = 1. Nothing is deleted, so
 * splits, notes and tags stay visible in the review list (GET /sync/review).
 */
import type { z } from "zod";
import { transactions } from "../db/schema.ts";
import { bulkUpsert, chunkJson, selectWhereIn } from "../db/bulk.ts";
import { newId } from "../deps.ts";
import { PlaidApiError, trimTransaction, type PlaidClient, type transactionSchema } from "../plaid/index.ts";
import type { AppEnv } from "../env.ts";
import { accountIdMap, accountUpsertStatements } from "./accounts.ts";

type PlaidTransaction = z.infer<typeof transactionSchema>;

export interface TransactionsSyncResult {
  added: number;
  modified: number;
  removed: number;
  pages: number;
  transactionsUpdateStatus: string | null;
  changedIds: string[];
  removedIds: string[];
}

/** Plaid's documented page size maximum. */
const PAGE_SIZE = 500;
/** Safety stop: 100 pages = 50k transactions in one run. */
const MAX_PAGES = 100;
const MAX_RESTARTS = 3;

const PLAID_TX_FIELDS = [
  "accountId",
  "amountCents",
  "isoCurrencyCode",
  "date",
  "authorizedDate",
  "pending",
  "pendingTransactionId",
  "rawDescription",
  "merchantName",
  "merchantEntityId",
  "plaidCategoryPrimary",
  "plaidCategoryDetailed",
  "plaidCategoryConfidence",
  "removed",
  "removedAt",
  "updatedAt",
] as const;

export async function syncTransactions(env: AppEnv, plaid: PlaidClient, itemId: string, accessToken: string, startCursor: string | null, today: string, now: string): Promise<TransactionsSyncResult> {
  const result: TransactionsSyncResult = { added: 0, modified: 0, removed: 0, pages: 0, transactionsUpdateStatus: null, changedIds: [], removedIds: [] };
  let cursor = startCursor;
  let restarts = 0;

  for (;;) {
    let page;
    try {
      page = await plaid.call("/transactions/sync", {
        access_token: accessToken,
        ...(cursor ? { cursor } : {}),
        count: PAGE_SIZE,
        options: { include_original_description: true, days_requested: 730 },
      });
    } catch (e) {
      // Plaid: restart the whole pagination loop from the cursor it started with.
      if (e instanceof PlaidApiError && e.errorCode === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" && restarts < MAX_RESTARTS) {
        restarts++;
        cursor = startCursor;
        await env.DB.prepare("UPDATE plaid_items SET transactions_cursor = ?1 WHERE id = ?2").bind(startCursor, itemId).run();
        continue;
      }
      throw e;
    }
    result.pages++;
    const statements: D1PreparedStatement[] = [...accountUpsertStatements(env, itemId, page.accounts, today, now)];
    if (statements.length) await env.DB.batch(statements);

    const applied = await applyPage(env, itemId, page.added, page.modified, page.removed.map((r) => r.transaction_id), now);
    result.added += page.added.length;
    result.modified += page.modified.length;
    result.removed += page.removed.length;
    result.changedIds.push(...applied.changedIds);
    result.removedIds.push(...applied.removedIds);
    result.transactionsUpdateStatus = page.transactions_update_status;

    await env.DB.batch([
      ...applied.statements,
      env.DB.prepare("UPDATE plaid_items SET transactions_cursor = ?1, transactions_update_status = ?2 WHERE id = ?3").bind(
        page.next_cursor,
        page.transactions_update_status,
        itemId,
      ),
    ]);
    cursor = page.next_cursor;
    if (!page.has_more) break;
    if (result.pages >= MAX_PAGES) break; // the next run continues from the saved cursor
  }
  return result;
}

interface ExistingRow {
  id: string;
  plaid_transaction_id: string;
  removed: number;
}

/** Statements for one page; reads current rows to decide pending → posted replacements. */
async function applyPage(env: AppEnv, itemId: string, added: PlaidTransaction[], modified: PlaidTransaction[], removedPlaidIds: string[], now: string) {
  const accountIds = await accountIdMap(env, itemId);
  // Plaid transactions always carry an id (it is only null for manual rows).
  const incoming = [...added, ...modified].map((p) => ({ ...trimTransaction(p), plaidTransactionId: p.transaction_id }));
  const lookupIds = [...incoming.map((t) => t.plaidTransactionId), ...incoming.flatMap((t) => (t.pendingTransactionId ? [t.pendingTransactionId] : []))];
  const existing = new Map(
    (await selectWhereIn<ExistingRow>(env.DB, "SELECT id, plaid_transaction_id, removed FROM transactions", "plaid_transaction_id", lookupIds)).map((r) => [
      r.plaid_transaction_id,
      r,
    ]),
  );

  const statements: D1PreparedStatement[] = [];
  const changedIds: string[] = [];
  const replacedRowIds: string[] = [];
  const replacedPendingPlaidIds = new Set<string>();
  const rows = [];
  for (const t of incoming) {
    const accountId = accountIds.get(t.plaidAccountId);
    if (!accountId) throw new Error(`Transaction for unknown account in item ${itemId}`);
    const { plaidAccountId: _drop, ...fields } = t;
    const values = { ...fields, accountId, removed: false, removedAt: null, updatedAt: now };

    const pendingRow = t.pendingTransactionId ? existing.get(t.pendingTransactionId) : undefined;
    if (pendingRow && !existing.has(t.plaidTransactionId)) {
      // Posted version of a pending transaction we already have: take over its row (and its edits).
      statements.push(
        env.DB.prepare(
          `UPDATE transactions SET plaid_transaction_id = ?1, account_id = ?2, amount_cents = ?3, iso_currency_code = ?4, date = ?5,
             authorized_date = ?6, pending = ?7, pending_transaction_id = ?8, raw_description = ?9, merchant_name = ?10,
             merchant_entity_id = ?11, plaid_category_primary = ?12, plaid_category_detailed = ?13, plaid_category_confidence = ?14,
             removed = 0, removed_at = NULL, updated_at = ?15
           WHERE id = ?16`,
        ).bind(
          t.plaidTransactionId,
          accountId,
          t.amountCents,
          t.isoCurrencyCode,
          t.date,
          t.authorizedDate,
          t.pending ? 1 : 0,
          t.pendingTransactionId,
          t.rawDescription,
          t.merchantName,
          t.merchantEntityId,
          t.plaidCategoryPrimary,
          t.plaidCategoryDetailed,
          t.plaidCategoryConfidence,
          now,
          pendingRow.id,
        ),
      );
      existing.delete(t.pendingTransactionId!);
      existing.set(t.plaidTransactionId, { ...pendingRow, plaid_transaction_id: t.plaidTransactionId, removed: 0 });
      changedIds.push(pendingRow.id);
      replacedRowIds.push(pendingRow.id);
      replacedPendingPlaidIds.add(t.pendingTransactionId!);
      continue;
    }
    const known = existing.get(t.plaidTransactionId);
    const id = known?.id ?? newId("tx");
    if (!known) existing.set(t.plaidTransactionId, { id, plaid_transaction_id: t.plaidTransactionId, removed: 0 });
    changedIds.push(id);
    rows.push({ id, ...values, isManual: false, createdAt: now });
  }
  statements.push(...bulkUpsert(env.DB, transactions, rows, { conflict: ["plaidTransactionId"], update: [...PLAID_TX_FIELDS] }));

  // A replaced pending row may have been flagged when its removal arrived first: clear those flags.
  for (const json of chunkJson(replacedRowIds)) {
    for (const table of ["transfer_links", "refund_links"] as const) {
      const [a, b] = table === "transfer_links" ? ["out_transaction_id", "in_transaction_id"] : ["refund_transaction_id", "purchase_transaction_id"];
      statements.push(
        env.DB.prepare(
          `UPDATE ${table} SET needs_review = 0 WHERE needs_review = 1
             AND (${a} IN (SELECT value FROM json_each(?1)) OR ${b} IN (SELECT value FROM json_each(?1)))
             AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.removed = 1 AND t.id IN (${table}.${a}, ${table}.${b}))`,
        ).bind(json),
      );
    }
  }

  // Removals: keep the row, mark it, flag links that depend on it.
  const removedIds: string[] = [];
  // A pending transaction replaced by its posted version above no longer exists under its old id.
  const toRemove = removedPlaidIds.filter((pid) => !replacedPendingPlaidIds.has(pid));
  if (toRemove.length) {
    const rowsRemoved = await selectWhereIn<{ id: string }>(env.DB, "SELECT id FROM transactions", "plaid_transaction_id", toRemove);
    removedIds.push(...rowsRemoved.map((r) => r.id));
    for (const json of chunkJson(toRemove)) {
      statements.push(
        env.DB.prepare(
          "UPDATE transactions SET removed = 1, removed_at = ?2, updated_at = ?2 WHERE removed = 0 AND plaid_transaction_id IN (SELECT value FROM json_each(?1))",
        ).bind(json, now),
      );
      const ids = "SELECT id FROM transactions WHERE plaid_transaction_id IN (SELECT value FROM json_each(?1))";
      statements.push(
        env.DB.prepare(
          `UPDATE transfer_links SET needs_review = 1 WHERE needs_review = 0 AND undone_at IS NULL AND (out_transaction_id IN (${ids}) OR in_transaction_id IN (${ids}))`,
        ).bind(json),
        env.DB.prepare(
          `UPDATE refund_links SET needs_review = 1 WHERE needs_review = 0 AND undone_at IS NULL AND (refund_transaction_id IN (${ids}) OR purchase_transaction_id IN (${ids}))`,
        ).bind(json),
      );
    }
  }
  return { statements, changedIds, removedIds };
}
