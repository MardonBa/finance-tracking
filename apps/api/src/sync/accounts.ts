/**
 * Account rows from Plaid. Only Plaid-owned fields are ever overwritten;
 * the user's nickname, hidden flag, type fix, protected amount and income
 * fallback are never touched by sync (§3 "rename it, hide it, fix its type").
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { z } from "zod";
import { accounts, plaidItems } from "../db/schema.ts";
import { bulkUpsert } from "../db/bulk.ts";
import { decryptString } from "../crypto/aes.ts";
import { newId } from "../deps.ts";
import { trimAccount, type accountSchema, type TrimmedAccount } from "../plaid/index.ts";
import type { AppEnv } from "../env.ts";

export type ItemRow = typeof plaidItems.$inferSelect;
type PlaidAccount = z.infer<typeof accountSchema>;

/**
 * The local dev seed's demo bank is not a real Plaid item: its "token" starts with
 * this prefix (seed/build-seed-sql.ts). Nothing may send it to Plaid.
 */
export const SEED_TOKEN_PREFIX = "seed-";
export const isSeedToken = (token: string) => token.startsWith(SEED_TOKEN_PREFIX);

export async function accessTokenFor(env: AppEnv, item: Pick<ItemRow, "accessTokenEnc">): Promise<string> {
  return decryptString(item.accessTokenEnc, env.TOKEN_ENC_KEY);
}

export async function loadItem(env: AppEnv, itemId: string): Promise<ItemRow | undefined> {
  return drizzle(env.DB).select().from(plaidItems).where(eq(plaidItems.id, itemId)).get();
}

/** Plaid-owned account fields, refreshed on every sync. */
const PLAID_ACCOUNT_FIELDS = ["name", "mask", "type", "subtype", "isoCurrencyCode", "currentBalanceCents", "balanceUpdatedAt"] as const;

export function newAccountRow(itemId: string, a: TrimmedAccount, today: string, now: string) {
  return {
    id: newId("acc"),
    itemId,
    plaidAccountId: a.plaidAccountId,
    name: a.name,
    mask: a.mask,
    type: a.type,
    subtype: a.subtype,
    isoCurrencyCode: a.isoCurrencyCode,
    currentBalanceCents: a.currentBalanceCents,
    balanceUpdatedAt: a.balanceUpdatedAt,
    connectedOn: today,
    createdAt: now,
  };
}

/** Statements that insert new accounts and refresh Plaid fields of known ones. */
export function accountUpsertStatements(env: AppEnv, itemId: string, plaidAccounts: readonly PlaidAccount[], today: string, now: string) {
  const rows = plaidAccounts.map((a) => newAccountRow(itemId, trimAccount(a, now), today, now));
  return bulkUpsert(env.DB, accounts, rows, { conflict: ["plaidAccountId"], update: [...PLAID_ACCOUNT_FIELDS] });
}

/** plaid_account_id → our account id, for one item. */
export async function accountIdMap(env: AppEnv, itemId: string): Promise<Map<string, string>> {
  const rows = await drizzle(env.DB)
    .select({ id: accounts.id, plaidAccountId: accounts.plaidAccountId })
    .from(accounts)
    .where(eq(accounts.itemId, itemId))
    .all();
  return new Map(rows.filter((r) => r.plaidAccountId).map((r) => [r.plaidAccountId!, r.id]));
}
