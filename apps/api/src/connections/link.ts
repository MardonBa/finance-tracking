/**
 * Connecting banks with Plaid Hosted Link (§3; spike in
 * docs/planning/plaid-hosted-link-spike.md).
 *
 * 1. createLinkSession: /link/token/create with hosted_link. Link runs in the
 *    system browser; at the end Plaid redirects to our /plaid/redirect page,
 *    which hands off to financetracker://plaid-complete?session=<our id>.
 *    Only our own session id travels through the redirect.
 * 2. finalizeSession: the backend collects the result from Plaid itself
 *    (/link/token/get; the SESSION_FINISHED webhook triggers the same code),
 *    exchanges the public token, encrypts the access token (TOKEN_ENC_KEY),
 *    fetches the accounts (trimmed) and saves item + accounts in ONE batch,
 *    so cancelling or failing anywhere before that leaves nothing saved.
 * 3. Duplicate banks (same institution, or accounts with the same mask and
 *    name/subtype) are held back with a warning until the user chooses:
 *    "discard", or "keep" (matching accounts are saved hidden, so they are
 *    never counted twice).
 */
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import { accounts, linkSessions, plaidItems } from "../db/schema.ts";
import { encryptString, decryptString } from "../crypto/aes.ts";
import { deps, newId, nowIso, plaidFor } from "../deps.ts";
import { ALLOWED_PRODUCTS, trimAccount, trimItem, type TrimmedAccount } from "../plaid/index.ts";
import type { AppEnv } from "../env.ts";
import { todayFor } from "../routes/registry.ts";
import { errorCodeOf } from "../sync/run.ts";

/** Plaid Trial plan: at most 10 Items (decision 002). */
export const TRIAL_ITEM_LIMIT = 10;
/** "Close to the limit" warning threshold (remaining connections). */
export const TRIAL_WARN_REMAINING = 2;
/** Maximum history Plaid allows; must be set when connecting (§3, §5). */
export const DAYS_REQUESTED = 730;
const HOSTED_LINK_URL_LIFETIME_S = 30 * 60;

export class LinkError extends Error {
  readonly code: string;
  readonly httpStatus: 400 | 404 | 409;
  constructor(code: string, message: string, httpStatus: 400 | 404 | 409 = 400) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

// ------------------------------------------------------------------ trial limit

export async function trialStatus(env: AppEnv) {
  // TODO(revisit): assumes Plaid counts every Item we created and still hold; removed items may still count.
  const row = await env.DB.prepare("SELECT count(*) AS n FROM plaid_items").first<{ n: number }>();
  const count = row?.n ?? 0;
  const remaining = Math.max(0, TRIAL_ITEM_LIMIT - count);
  return { count, limit: TRIAL_ITEM_LIMIT, remaining, status: remaining === 0 ? "reached" : remaining <= TRIAL_WARN_REMAINING ? "close" : "ok" } as const;
}

// ------------------------------------------------------------------ create

/** The exact /link/token/create body (exported so tests check only read-only products are requested). */
export function linkTokenRequest(env: AppEnv, sessionId: string, accessToken: string | null) {
  const base = env.PUBLIC_API_URL.replace(/\/+$/, "");
  const body: Record<string, unknown> = {
    client_name: "Finance Tracker",
    language: "en",
    country_codes: ["US"],
    user: { client_user_id: "owner" },
    hosted_link: {
      completion_redirect_uri: `${base}/plaid/redirect?session=${encodeURIComponent(sessionId)}`,
      url_lifetime_seconds: HOSTED_LINK_URL_LIFETIME_S,
    },
  };
  // Plaid can only deliver webhooks to a public https URL (not local wrangler dev).
  if (base.startsWith("https://")) body.webhook = `${base}/plaid/webhook`;
  if (accessToken) {
    body.access_token = accessToken; // update mode: no products, keeps all history (§4)
  } else {
    body.products = ["transactions"];
    // Added when the bank supports them; Link never fails because of them.
    body.optional_products = ALLOWED_PRODUCTS.filter((p) => p !== "transactions");
    body.transactions = { days_requested: DAYS_REQUESTED };
  }
  return body;
}

export async function createLinkSession(env: AppEnv, opts: { itemId?: string }) {
  const db = drizzle(env.DB);
  let accessToken: string | null = null;
  if (opts.itemId) {
    const item = await db.select().from(plaidItems).where(eq(plaidItems.id, opts.itemId)).get();
    if (!item) throw new LinkError("ITEM_NOT_FOUND", "Unknown connection", 404);
    accessToken = await decryptString(item.accessTokenEnc, env.TOKEN_ENC_KEY);
  } else {
    const trial = await trialStatus(env);
    if (trial.status === "reached") throw new LinkError("TRIAL_LIMIT_REACHED", `Plaid's Trial allows ${TRIAL_ITEM_LIMIT} bank connections`, 409);
  }
  const sessionId = newId("ls");
  const res = await plaidFor(env).call("/link/token/create", linkTokenRequest(env, sessionId, accessToken) as never);
  if (!res.hosted_link_url) throw new Error("Plaid did not return a Hosted Link URL");
  await db.insert(linkSessions).values({
    id: sessionId,
    linkToken: res.link_token,
    mode: opts.itemId ? "update" : "new",
    itemId: opts.itemId ?? null,
    status: "pending",
    errorCode: null,
    pendingAccessTokenEnc: null,
    pendingResultJson: null,
    expiresAt: new Date(Date.parse(res.expiration)).toISOString(),
    createdAt: nowIso(),
    finishedAt: null,
  });
  return { sessionId, hostedLinkUrl: res.hosted_link_url, expiresAt: res.expiration, mode: opts.itemId ? "update" : "new" };
}

// ------------------------------------------------------------------ finalize

type Session = typeof linkSessions.$inferSelect;

export interface FoundAccount {
  id: string | null;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
  currentBalanceCents: number | null;
  hidden: boolean;
}

export interface DuplicateMatch {
  existingItemId: string;
  existingInstitutionName: string | null;
  sameInstitution: boolean;
  matchingAccounts: Array<{ newAccountName: string; mask: string | null; existingAccountId: string; existingAccountName: string }>;
}

export type FinalizeResult =
  | { status: "pending" | "finalizing"; sessionId: string }
  | { status: "done"; sessionId: string; itemId: string; institutionName: string | null; accounts: FoundAccount[] }
  | { status: "duplicate"; sessionId: string; institutionName: string | null; accounts: FoundAccount[]; duplicates: DuplicateMatch[] }
  | { status: "cancelled" | "failed"; sessionId: string; errorCode: string | null };

const pendingResultSchema = z.object({
  item: z.object({ plaidItemId: z.string(), institutionId: z.string().nullable(), institutionName: z.string().nullable(), consentExpiresAt: z.string().nullable() }),
  accounts: z.array(z.custom<TrimmedAccount>()),
  duplicates: z.array(z.custom<DuplicateMatch>()),
});
type PendingResult = z.infer<typeof pendingResultSchema>;

async function loadSession(env: AppEnv, sessionId: string): Promise<Session> {
  const s = await drizzle(env.DB).select().from(linkSessions).where(eq(linkSessions.id, sessionId)).get();
  if (!s) throw new LinkError("SESSION_NOT_FOUND", "Unknown link session", 404);
  return s;
}

async function setSession(env: AppEnv, id: string, values: Partial<Session>) {
  await drizzle(env.DB).update(linkSessions).set(values).where(eq(linkSessions.id, id));
}

function foundAccounts(list: TrimmedAccount[], hiddenPlaidIds: Set<string> = new Set()): FoundAccount[] {
  return list.map((a) => ({
    id: null,
    name: a.name,
    mask: a.mask,
    type: a.type,
    subtype: a.subtype,
    currentBalanceCents: a.currentBalanceCents,
    hidden: hiddenPlaidIds.has(a.plaidAccountId ?? ""),
  }));
}

async function accountsOfItem(env: AppEnv, itemId: string): Promise<FoundAccount[]> {
  const rows = await drizzle(env.DB)
    .select({ id: accounts.id, name: accounts.name, mask: accounts.mask, type: accounts.type, subtype: accounts.subtype, currentBalanceCents: accounts.currentBalanceCents, hidden: accounts.hidden })
    .from(accounts)
    .where(eq(accounts.itemId, itemId))
    .all();
  return rows;
}

/** The current outcome of a session that is no longer pending. */
async function describe(env: AppEnv, s: Session): Promise<FinalizeResult> {
  switch (s.status) {
    case "pending":
    case "finalizing":
      return { status: s.status, sessionId: s.id };
    case "done": {
      const item = s.itemId ? await drizzle(env.DB).select().from(plaidItems).where(eq(plaidItems.id, s.itemId)).get() : undefined;
      return { status: "done", sessionId: s.id, itemId: s.itemId!, institutionName: item?.institutionName ?? null, accounts: s.itemId ? await accountsOfItem(env, s.itemId) : [] };
    }
    case "duplicate": {
      const p = pendingResultSchema.parse(JSON.parse(s.pendingResultJson ?? "null"));
      return { status: "duplicate", sessionId: s.id, institutionName: p.item.institutionName, accounts: foundAccounts(p.accounts), duplicates: p.duplicates };
    }
    case "cancelled":
    case "failed":
      return { status: s.status, sessionId: s.id, errorCode: s.errorCode };
  }
}

export function detectDuplicates(
  newItem: { institutionId: string | null },
  newAccounts: TrimmedAccount[],
  existingItems: Array<{ id: string; institutionId: string | null; institutionName: string | null }>,
  existingAccounts: Array<{ id: string; itemId: string | null; name: string; mask: string | null; type: string; subtype: string | null; isManual: boolean }>,
): DuplicateMatch[] {
  const norm = (s: string | null) => (s ?? "").trim().toLowerCase();
  const byItem = new Map<string, DuplicateMatch>();
  const entry = (itemId: string) => {
    let m = byItem.get(itemId);
    if (!m) {
      const item = existingItems.find((i) => i.id === itemId);
      m = { existingItemId: itemId, existingInstitutionName: item?.institutionName ?? null, sameInstitution: false, matchingAccounts: [] };
      byItem.set(itemId, m);
    }
    return m;
  };
  for (const item of existingItems) {
    if (newItem.institutionId && item.institutionId === newItem.institutionId) entry(item.id).sameInstitution = true;
  }
  for (const a of newAccounts) {
    for (const b of existingAccounts) {
      if (b.isManual || !b.itemId || a.type !== b.type) continue;
      const sameMask = !!a.mask && a.mask === b.mask;
      const sameName = norm(a.name) === norm(b.name);
      const sameSubtype = !!a.subtype && a.subtype === b.subtype;
      if ((sameMask && (sameName || sameSubtype)) || (!a.mask && !b.mask && sameName && sameSubtype)) {
        entry(b.itemId).matchingAccounts.push({ newAccountName: a.name, mask: a.mask, existingAccountId: b.id, existingAccountName: b.name });
      }
    }
  }
  return [...byItem.values()];
}

/** Save item + accounts atomically; `hide` lists Plaid account ids saved hidden (duplicates). */
async function saveItem(env: AppEnv, session: Session, accessTokenEnc: string, p: Pick<PendingResult, "item" | "accounts">, hide: Set<string>): Promise<string> {
  const db = drizzle(env.DB);
  const now = nowIso();
  const today = todayFor(env, deps.now());
  const itemId = newId("item");
  await db.batch([
    db.insert(plaidItems).values({
      id: itemId,
      plaidItemId: p.item.plaidItemId,
      institutionId: p.item.institutionId,
      institutionName: p.item.institutionName,
      accessTokenEnc,
      transactionsCursor: null,
      status: "ok",
      errorCode: null,
      consentExpiresAt: p.item.consentExpiresAt,
      lastSuccessfulUpdateAt: null,
      lastSyncedAt: null,
      createdAt: now,
      transactionsUpdateStatus: null,
      refreshAvailableAt: null,
    }),
    ...p.accounts.map((a) =>
      db.insert(accounts).values({
        id: newId("acc"),
        itemId,
        ...a,
        hidden: hide.has(a.plaidAccountId ?? ""),
        connectedOn: today,
        createdAt: now,
      }),
    ),
    db
      .update(linkSessions)
      .set({ status: "done", itemId, finishedAt: now, pendingAccessTokenEnc: null, pendingResultJson: null, errorCode: null })
      .where(eq(linkSessions.id, session.id)),
  ]);
  return itemId;
}

/**
 * Collect a finished Link session from Plaid and save the new bank. Safe to
 * call repeatedly and concurrently (the app after the redirect, the
 * SESSION_FINISHED webhook): a session is claimed atomically, and a finished
 * one just reports its outcome.
 */
export async function finalizeSession(env: AppEnv, sessionId: string): Promise<{ result: FinalizeResult; newItemId: string | null; repairedItemId?: string | null }> {
  let s = await loadSession(env, sessionId);
  if (s.status !== "pending") return { result: await describe(env, s), newItemId: null };
  const claimed = await env.DB.prepare("UPDATE link_sessions SET status = 'finalizing' WHERE id = ?1 AND status = 'pending'").bind(sessionId).run();
  if ((claimed.meta.changes ?? 0) !== 1) return { result: await describe(env, await loadSession(env, sessionId)), newItemId: null };

  const plaid = plaidFor(env);
  try {
    const got = await plaid.call("/link/token/get", { link_token: s.linkToken });
    const sessions = got.link_sessions ?? [];
    const finished = sessions.filter((x) => x.finished_at);
    const publicTokens = finished.flatMap((x) => x.results?.item_add_results ?? []).map((r) => r.public_token);

    if (finished.length === 0) {
      if (Date.parse(s.expiresAt) <= deps.now()) {
        await setSession(env, sessionId, { status: "cancelled", errorCode: "LINK_EXPIRED", finishedAt: nowIso() });
      } else {
        await setSession(env, sessionId, { status: "pending" });
      }
      return { result: await describe(env, await loadSession(env, sessionId)), newItemId: null };
    }

    const exitCode = finished.map((x) => x.exit?.error?.error_code).find(Boolean) ?? null;

    if (s.mode === "update") {
      if (exitCode || finished.every((x) => x.exit)) {
        await setSession(env, sessionId, { status: "cancelled", errorCode: exitCode ?? "USER_EXIT", finishedAt: nowIso() });
      } else {
        // Update mode needs no exchange; the same access token works again.
        await drizzle(env.DB).update(plaidItems).set({ status: "ok", errorCode: null }).where(eq(plaidItems.id, s.itemId!));
        await setSession(env, sessionId, { status: "done", finishedAt: nowIso() });
        return { result: await describe(env, await loadSession(env, sessionId)), newItemId: null, repairedItemId: s.itemId };
      }
      return { result: await describe(env, await loadSession(env, sessionId)), newItemId: null };
    }

    const publicToken = publicTokens[0];
    if (!publicToken) {
      await setSession(env, sessionId, { status: "cancelled", errorCode: exitCode ?? "USER_EXIT", finishedAt: nowIso() });
      return { result: await describe(env, await loadSession(env, sessionId)), newItemId: null };
    }
    // TODO(revisit): one bank per Link session; extra item_add_results (multi-item Link) are ignored.

    const exchanged = await plaid.call("/item/public_token/exchange", { public_token: publicToken });
    const accessTokenEnc = await encryptString(exchanged.access_token, env.TOKEN_ENC_KEY);
    const itemInfo = trimItem(await plaid.call("/item/get", { access_token: exchanged.access_token }));
    let institutionName = itemInfo.institutionName;
    if (!institutionName && itemInfo.institutionId) {
      institutionName = (await plaid.call("/institutions/get_by_id", { institution_id: itemInfo.institutionId, country_codes: ["US"] })).institution.name;
    }
    const fetchedAt = nowIso();
    const accts = (await plaid.call("/accounts/get", { access_token: exchanged.access_token })).accounts.map((a) => trimAccount(a, fetchedAt));
    const item = { plaidItemId: itemInfo.plaidItemId, institutionId: itemInfo.institutionId, institutionName, consentExpiresAt: itemInfo.consentExpiresAt };

    const db = drizzle(env.DB);
    const existingItems = await db.select({ id: plaidItems.id, institutionId: plaidItems.institutionId, institutionName: plaidItems.institutionName }).from(plaidItems).all();
    const existingAccounts = await db
      .select({ id: accounts.id, itemId: accounts.itemId, name: accounts.name, mask: accounts.mask, type: accounts.type, subtype: accounts.subtype, isManual: accounts.isManual })
      .from(accounts)
      .all();
    const duplicates = detectDuplicates(item, accts, existingItems, existingAccounts);
    if (duplicates.length > 0) {
      const pending: PendingResult = { item, accounts: accts, duplicates };
      await setSession(env, sessionId, { status: "duplicate", pendingAccessTokenEnc: accessTokenEnc, pendingResultJson: JSON.stringify(pending), finishedAt: nowIso() });
      return { result: await describe(env, await loadSession(env, sessionId)), newItemId: null };
    }
    s = await loadSession(env, sessionId);
    const itemId = await saveItem(env, s, accessTokenEnc, { item, accounts: accts }, new Set());
    return { result: await describe(env, await loadSession(env, sessionId)), newItemId: itemId };
  } catch (e) {
    // Nothing was saved: item and accounts are written only by saveItem's single batch.
    await setSession(env, sessionId, { status: "failed", errorCode: errorCodeOf(e), finishedAt: nowIso() }).catch(() => {});
    return { result: { status: "failed", sessionId, errorCode: errorCodeOf(e) }, newItemId: null };
  }
}

/** The user's choice after a duplicate warning. */
export async function resolveDuplicate(env: AppEnv, sessionId: string, choice: "keep" | "discard"): Promise<{ result: FinalizeResult; newItemId: string | null }> {
  const s = await loadSession(env, sessionId);
  if (s.status !== "duplicate" || !s.pendingAccessTokenEnc || !s.pendingResultJson) throw new LinkError("NOT_A_DUPLICATE", "This session is not waiting for a duplicate decision", 409);
  if (choice === "discard") {
    // TODO(revisit): the Plaid item stays at Plaid (/item/remove is not on the read-only allowlist) and may count toward the Trial limit.
    await setSession(env, sessionId, { status: "cancelled", errorCode: "DUPLICATE_DISCARDED", pendingAccessTokenEnc: null, pendingResultJson: null });
    return { result: await describe(env, await loadSession(env, sessionId)), newItemId: null };
  }
  const p = pendingResultSchema.parse(JSON.parse(s.pendingResultJson));
  const matchedKeys = new Set(p.duplicates.flatMap((d) => d.matchingAccounts.map((m) => `${m.newAccountName}|${m.mask}`)));
  const hide = new Set(p.accounts.filter((a) => matchedKeys.has(`${a.name}|${a.mask}`)).map((a) => a.plaidAccountId ?? ""));
  const itemId = await saveItem(env, s, s.pendingAccessTokenEnc, p, hide);
  return { result: await describe(env, await loadSession(env, sessionId)), newItemId: itemId };
}

/** Find the session for a Plaid link token (SESSION_FINISHED webhook). */
export async function sessionIdForLinkToken(env: AppEnv, linkToken: string): Promise<string | null> {
  const row = await drizzle(env.DB).select({ id: linkSessions.id }).from(linkSessions).where(and(eq(linkSessions.linkToken, linkToken), inArray(linkSessions.status, ["pending"]))).get();
  return row?.id ?? null;
}
