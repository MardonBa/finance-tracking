/**
 * Everything a sync fetches besides transactions (§4, §9, §17): live
 * balances, investment holdings and activity, credit card liabilities and
 * recurring streams. Each upserts by Plaid's stable id, so repeating is safe,
 * and never overwrites the user's own fields (paying account, recurring edits
 * live in their own tables, notes on investment activity).
 */
import { addDays } from "@ft/core";
import { holdings, investmentTransactions, liabilities, recurringItems, recurringItemTransactions, securities } from "../db/schema.ts";
import { bulkUpsert, selectWhereIn } from "../db/bulk.ts";
import { newId } from "../deps.ts";
import {
  PlaidApiError,
  trimCreditLiability,
  trimHolding,
  trimInvestmentTransaction,
  trimSecurity,
  trimStream,
  type PlaidClient,
} from "../plaid/index.ts";
import type { AppEnv } from "../env.ts";
import { accountIdMap, accountUpsertStatements } from "./accounts.ts";

/** Errors meaning "this product has nothing for this item (yet)": skipped quietly. */
const NOT_APPLICABLE = new Set(["PRODUCT_NOT_READY", "PRODUCTS_NOT_SUPPORTED", "NO_INVESTMENT_ACCOUNTS", "NO_LIABILITY_ACCOUNTS", "NO_ACCOUNTS"]);

async function optional<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof PlaidApiError && e.errorCode && NOT_APPLICABLE.has(e.errorCode)) return null;
    throw e;
  }
}

/** /accounts/balance/get: live balances (Refresh only; it asks the bank right now). */
export async function syncLiveBalances(env: AppEnv, plaid: PlaidClient, itemId: string, accessToken: string, today: string, now: string) {
  const res = await plaid.call("/accounts/balance/get", { access_token: accessToken });
  const statements = accountUpsertStatements(env, itemId, res.accounts, today, now);
  if (statements.length) await env.DB.batch(statements);
  return res.accounts.length;
}

/** Days of investment activity to fetch: full history on the first sync, then a trailing window. */
const INVESTMENT_HISTORY_DAYS = 730;
const INVESTMENT_RECENT_DAYS = 30;

export async function syncInvestments(env: AppEnv, plaid: PlaidClient, itemId: string, accessToken: string, today: string, now: string) {
  const h = await optional(() => plaid.call("/investments/holdings/get", { access_token: accessToken }));
  if (!h) return { holdings: 0, transactions: 0 };
  await env.DB.batch([
    ...accountUpsertStatements(env, itemId, h.accounts, today, now),
    ...securityStatements(env, h.securities.map(trimSecurity)),
  ]);
  const accountIds = await accountIdMap(env, itemId);
  const secIds = await securityIdMap(env, h.securities.map((s) => s.security_id));
  const holdingRows = h.holdings.map(trimHolding).flatMap((x) => {
    const accountId = accountIds.get(x.plaidAccountId);
    const securityId = secIds.get(x.plaidSecurityId);
    if (!accountId || !securityId) return [];
    return [{ accountId, securityId, asOfDate: today, quantity: x.quantity, valueCents: x.valueCents, isoCurrencyCode: x.isoCurrencyCode }];
  });

  // Investment activity, paginated by offset.
  const known = await env.DB.prepare(
    "SELECT count(*) AS n FROM investment_transactions it JOIN accounts a ON a.id = it.account_id WHERE a.item_id = ?1",
  )
    .bind(itemId)
    .first<{ n: number }>();
  const startDate = addDays(today, -(known?.n ? INVESTMENT_RECENT_DAYS : INVESTMENT_HISTORY_DAYS));
  const txRows = [];
  const extraSecurities = [];
  let offset = 0;
  for (let guard = 0; guard < 50; guard++) {
    const page = await optional(() =>
      plaid.call("/investments/transactions/get", { access_token: accessToken, start_date: startDate, end_date: today, options: { count: 500, offset } }),
    );
    if (!page) break;
    extraSecurities.push(...page.securities.map(trimSecurity));
    txRows.push(...page.investment_transactions.map(trimInvestmentTransaction));
    offset += page.investment_transactions.length;
    if (page.investment_transactions.length === 0 || offset >= page.total_investment_transactions) break;
  }
  if (extraSecurities.length) await env.DB.batch(securityStatements(env, extraSecurities));
  const allSecIds = await securityIdMap(env, txRows.flatMap((t) => (t.plaidSecurityId ? [t.plaidSecurityId] : [])));
  const invRows = txRows.flatMap((t) => {
    const accountId = accountIds.get(t.plaidAccountId);
    if (!accountId) return [];
    return [
      {
        id: newId("itx"),
        plaidInvestmentTransactionId: t.plaidInvestmentTransactionId,
        accountId,
        securityId: t.plaidSecurityId ? (allSecIds.get(t.plaidSecurityId) ?? null) : null,
        date: t.date,
        type: t.type,
        subtype: t.subtype,
        amountCents: t.amountCents,
        quantity: t.quantity,
        feesCents: t.feesCents,
        rawDescription: t.rawDescription,
      },
    ];
  });
  const statements = [
    ...bulkUpsert(env.DB, holdings, holdingRows, { conflict: ["accountId", "securityId", "asOfDate"], update: ["quantity", "valueCents", "isoCurrencyCode"] }),
    ...bulkUpsert(env.DB, investmentTransactions, invRows, {
      conflict: ["plaidInvestmentTransactionId"],
      update: ["accountId", "securityId", "date", "type", "subtype", "amountCents", "quantity", "feesCents", "rawDescription"],
    }),
  ];
  if (statements.length) await env.DB.batch(statements);
  return { holdings: holdingRows.length, transactions: invRows.length };
}

function securityStatements(env: AppEnv, list: ReturnType<typeof trimSecurity>[]) {
  const unique = [...new Map(list.map((s) => [s.plaidSecurityId, s])).values()];
  const rows = unique.map((s) => ({ id: newId("sec"), ...s }));
  return bulkUpsert(env.DB, securities, rows, { conflict: ["plaidSecurityId"], update: ["name", "tickerSymbol", "type"] });
}

async function securityIdMap(env: AppEnv, plaidIds: string[]) {
  const rows = await selectWhereIn<{ id: string; plaid_security_id: string }>(env.DB, "SELECT id, plaid_security_id FROM securities", "plaid_security_id", plaidIds);
  return new Map(rows.map((r) => [r.plaid_security_id, r.id]));
}

/** Credit card statement balance, due date and minimum payment (§9). */
export async function syncLiabilities(env: AppEnv, plaid: PlaidClient, itemId: string, accessToken: string, today: string, now: string) {
  const res = await optional(() => plaid.call("/liabilities/get", { access_token: accessToken }));
  if (!res) return 0;
  const accountStatements = accountUpsertStatements(env, itemId, res.accounts, today, now);
  if (accountStatements.length) await env.DB.batch(accountStatements);
  const accountIds = await accountIdMap(env, itemId);
  const rows = (res.liabilities.credit ?? []).map(trimCreditLiability).flatMap((l) => {
    const accountId = l.plaidAccountId ? accountIds.get(l.plaidAccountId) : undefined;
    if (!accountId) return [];
    const { plaidAccountId: _drop, ...fields } = l;
    return [{ accountId, ...fields, updatedAt: now }];
  });
  const statements = bulkUpsert(env.DB, liabilities, rows, {
    conflict: ["accountId"],
    update: ["lastStatementBalanceCents", "lastStatementIssueDate", "nextPaymentDueDate", "minimumPaymentCents", "updatedAt"],
  });
  if (statements.length) await env.DB.batch(statements);
  return rows.length;
}

/** Plaid's recurring streams (§9). My edits live in recurring_overrides and are never touched. */
export async function syncRecurring(env: AppEnv, plaid: PlaidClient, itemId: string, accessToken: string, today: string) {
  const res = await optional(() => plaid.call("/transactions/recurring/get", { access_token: accessToken }));
  if (!res) return 0;
  const streams = [...res.inflow_streams.map((s) => trimStream(s, "inflow")), ...res.outflow_streams.map((s) => trimStream(s, "outflow"))];
  const accountIds = await accountIdMap(env, itemId);
  const rows = streams.flatMap((s) => {
    const accountId = accountIds.get(s.plaidAccountId);
    if (!accountId) return [];
    return [
      {
        id: newId("rec"),
        plaidStreamId: s.plaidStreamId,
        source: "auto",
        accountId,
        direction: s.direction,
        description: s.description,
        merchantName: s.merchantName,
        category: s.category,
        frequency: s.frequency,
        averageAmountCents: s.averageAmountCents,
        lastAmountCents: s.lastAmountCents,
        lastDate: s.lastDate,
        predictedNextDate: s.predictedNextDate,
        isActive: s.isActive,
        plaidStatus: s.plaidStatus,
        firstSeenOn: today,
      },
    ];
  });
  const upserts = bulkUpsert(env.DB, recurringItems, rows, {
    conflict: ["plaidStreamId"],
    update: ["accountId", "direction", "description", "merchantName", "category", "frequency", "averageAmountCents", "lastAmountCents", "lastDate", "predictedNextDate", "isActive", "plaidStatus"],
  });
  if (upserts.length) await env.DB.batch(upserts);

  // Link each stream to the past occurrences we have (projections show what they're based on).
  const streamIds = new Map(
    (await selectWhereIn<{ id: string; plaid_stream_id: string }>(env.DB, "SELECT id, plaid_stream_id FROM recurring_items", "plaid_stream_id", streams.map((s) => s.plaidStreamId))).map(
      (r) => [r.plaid_stream_id, r.id],
    ),
  );
  const txIds = new Map(
    (
      await selectWhereIn<{ id: string; plaid_transaction_id: string }>(
        env.DB,
        "SELECT id, plaid_transaction_id FROM transactions",
        "plaid_transaction_id",
        streams.flatMap((s) => s.plaidTransactionIds),
      )
    ).map((r) => [r.plaid_transaction_id, r.id]),
  );
  const links = streams.flatMap((s) => {
    const recurringItemId = streamIds.get(s.plaidStreamId);
    if (!recurringItemId) return [];
    return s.plaidTransactionIds.flatMap((pid) => {
      const transactionId = txIds.get(pid);
      return transactionId ? [{ recurringItemId, transactionId }] : [];
    });
  });
  const linkStatements = bulkUpsert(env.DB, recurringItemTransactions, links, { conflict: ["recurringItemId", "transactionId"], update: [] });
  if (linkStatements.length) await env.DB.batch(linkStatements);
  return rows.length;
}
