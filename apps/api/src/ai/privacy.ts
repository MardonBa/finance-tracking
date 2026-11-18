/**
 * What the model may see (§16 "Privacy and cost", decision 006).
 *
 * Every tool result passes through `forModel` before it is sent to Gemini:
 * - identifier fields are dropped (Plaid ids and tokens, bank account names,
 *   institution ids, emails, owner names, account/routing numbers);
 * - accounts are named only by nickname (or their kind) plus the last 4
 *   digits, e.g. "Checking ••0000";
 * - strings are scrubbed of emails, long digit runs (account or card
 *   numbers) and Plaid access tokens, which can hide in raw descriptions;
 * - long arrays are cut down so the model gets totals and a sample, never a
 *   bulk dump (there is no export tool either).
 */
import { Balances, type Account } from "@ft/core";

/** Keys never sent to the model, at any depth. */
export const DROPPED_KEYS: ReadonlySet<string> = new Set([
  "plaidAccountId",
  "plaidItemId",
  "plaidTransactionId",
  "plaidSecurityId",
  "pendingTransactionId",
  "merchantEntityId",
  "accessToken",
  "accessTokenEnc",
  "transactionsCursor",
  "institutionId",
  "bankName",
  "officialName",
  "email",
  "ownerName",
  "ownerNames",
  "accountNumber",
  "routingNumber",
]);

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
/** 8+ digits standing alone (not part of an id like a UUID segment or "tx_123"). */
const LONG_NUMBER = /(?<![\w-])\d{8,}(?![\w-])/g;
const PLAID_TOKEN = /\b(access|public|link)-(sandbox|development|production)-[\w-]+/gi;

export interface AccountLabels {
  /** Raw bank account name → safe label, longest first (for substring replacement). */
  replacements: [string, string][];
}

function titleCase(s: string): string {
  return s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** "Nickname ••1234", or the account kind when there's no nickname ("Checking ••1234"). */
export function safeAccountLabel(a: Pick<Account, "nickname" | "mask" | "type" | "subtype" | "kindOverride" | "isManual">): string {
  const base = a.nickname?.trim() || titleCase(a.subtype ?? Balances.accountKind(a as never) ?? a.type);
  return a.mask ? `${base} ••${a.mask}` : base;
}

export function accountLabels(accounts: readonly Account[]): AccountLabels {
  const replacements: [string, string][] = [];
  for (const a of accounts) {
    const label = safeAccountLabel(a);
    if (a.name && a.name.trim().length >= 3 && a.name !== label) replacements.push([a.name, label]);
  }
  replacements.sort((x, y) => y[0].length - x[0].length);
  return { replacements };
}

export function scrubString(s: string, labels: AccountLabels): string {
  let out = s;
  for (const [raw, safe] of labels.replacements) if (out.includes(raw)) out = out.split(raw).join(safe);
  return out.replace(PLAID_TOKEN, "[token removed]").replace(EMAIL, "[email removed]").replace(LONG_NUMBER, "[number removed]");
}

export interface CompactOptions {
  /** Longest array kept; longer arrays keep their first items and say how many were left out. */
  maxArray: number;
}

/** Sanitize a value for the model: drop identifier keys, scrub strings, cut long arrays. */
export function sanitize(value: unknown, labels: AccountLabels, opts: CompactOptions = { maxArray: 40 }): unknown {
  if (typeof value === "string") return scrubString(value, labels);
  if (Array.isArray(value)) {
    const kept = value.slice(0, opts.maxArray).map((v) => sanitize(v, labels, opts));
    if (value.length > opts.maxArray) kept.push({ _omitted: `${value.length - opts.maxArray} more of ${value.length} not shown` });
    return kept;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (DROPPED_KEYS.has(k)) continue;
      out[k] = sanitize(v, labels, opts);
    }
    return out;
  }
  return value;
}

/** Hard cap on one tool result sent to the model (characters of JSON). */
export const MAX_RESULT_CHARS = 14_000;

/** Sanitize, then shrink arrays until the JSON fits MAX_RESULT_CHARS. */
export function forModel(value: unknown, labels: AccountLabels): unknown {
  for (const maxArray of [40, 20, 10, 5, 2]) {
    const out = sanitize(value, labels, { maxArray });
    if (JSON.stringify(out).length <= MAX_RESULT_CHARS) return out;
  }
  const s = JSON.stringify(sanitize(value, labels, { maxArray: 1 }));
  return { _truncated: true, preview: s.slice(0, MAX_RESULT_CHARS) };
}
