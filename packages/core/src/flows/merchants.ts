/**
 * Merchant normalisation (§7): "AMAZON MKTP US*2K4" and "Amazon.com" are one
 * merchant. Grouping is automatic by a normalised key; the user can merge
 * (aliases pointing several keys at one Merchant row) or separate (an alias on
 * one exact raw string pointing at its own Merchant).
 *
 * Resolution order for a transaction, first hit wins:
 *   1. alias on `entity:<merchantEntityId>` (Plaid's stable merchant id)
 *   2. alias on `raw:<exact description>` (set by "separate")
 *   3. alias on the normalised key (set by "merge")
 *   4. automatic group `auto:<normalised key>`
 */
import type { Merchant, MerchantAlias, Transaction } from "../types.ts";

const PROCESSOR_PREFIXES = [/^SQ\s*\*/, /^TST\s*\*/, /^SP\s*\*?\s+/, /^PAYPAL\s*\*/, /^PP\s*\*/, /^POS\s+/, /^DEBIT\s+/, /^CHECKCARD\s+/, /^PURCHASE\s+/];

/** Words that never distinguish merchants. */
const NOISE = new Set([
  "MKTP",
  "MKTPLACE",
  "MARKETPLACE",
  "US",
  "USA",
  "COM",
  "INC",
  "LLC",
  "LTD",
  "CO",
  "CORP",
  "WWW",
  "REFUND",
  "RETURN",
  "PAYMENT",
  "PURCHASE",
  "POS",
  "DEBIT",
  "STORE",
  "THE",
]);

/**
 * The automatic grouping key of a merchant string. Upper-case, processor
 * prefixes removed, everything after "*" dropped (order numbers), ".com"
 * and similar suffixes, store numbers and noise words removed.
 */
export function normalizeMerchantKey(text: string): string {
  let s = text.toUpperCase().trim();
  for (const re of PROCESSOR_PREFIXES) s = s.replace(re, "");
  const star = s.indexOf("*");
  if (star > 0) s = s.slice(0, star);
  s = s.replace(/\.(COM|NET|ORG|CO)\b/g, " ");
  s = s.replace(/'/g, "");
  s = s.replace(/[^A-Z0-9 ]+/g, " ");
  const words = s
    .split(/\s+/)
    .filter((w) => w.length > 0 && !NOISE.has(w) && !/\d/.test(w));
  const key = words.join(" ");
  return key.length > 0 ? key : text.toUpperCase().trim();
}

/** "TRADER JOES" → "Trader Joes". */
function titleCase(key: string): string {
  return key
    .toLowerCase()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function rawAliasKey(rawDescription: string): string {
  return `raw:${rawDescription.trim().toUpperCase()}`;
}

export function entityAliasKey(entityId: string): string {
  return `entity:${entityId}`;
}

export interface ResolvedMerchant {
  /** Stable grouping key: a Merchant.id, or "auto:<normalised key>". */
  key: string;
  name: string;
  /** The normalised key of this transaction's own text (what a merge aliases). */
  normalizedKey: string;
}

export interface MerchantResolver {
  resolve(tx: Pick<Transaction, "merchantName" | "rawDescription" | "merchantEntityId">): ResolvedMerchant;
}

export function merchantResolver(merchants: readonly Merchant[], aliases: readonly MerchantAlias[]): MerchantResolver {
  const byId = new Map(merchants.map((m) => [m.id, m]));
  const aliasMap = new Map<string, string>();
  // Sort for determinism when two aliases share a key (first by id wins).
  for (const a of [...aliases].sort((p, q) => (p.id < q.id ? -1 : 1))) {
    if (!aliasMap.has(a.matchKey) && byId.has(a.merchantId)) aliasMap.set(a.matchKey, a.merchantId);
  }
  return {
    resolve(tx) {
      const text = tx.merchantName ?? tx.rawDescription;
      const normalizedKey = normalizeMerchantKey(text);
      const candidates = [
        tx.merchantEntityId ? entityAliasKey(tx.merchantEntityId) : null,
        rawAliasKey(tx.rawDescription),
        normalizedKey,
      ];
      for (const c of candidates) {
        if (c === null) continue;
        const id = aliasMap.get(c);
        if (id) return { key: id, name: byId.get(id)!.name, normalizedKey };
      }
      return {
        key: `auto:${normalizedKey}`,
        name: tx.merchantName ?? titleCase(normalizedKey),
        normalizedKey,
      };
    },
  };
}
