/** Shared pieces for the flows / transactions / spending / budgets actions. */
import { z } from "zod";
import { ActionError, findRow, inverseMutations, type ActionContext, type Mutation } from "../registry.ts";
import type { Bucket, CoreData, Necessity, Rule, RuleMatchKind, Transaction, TransactionOverride } from "../types.ts";
import { Money } from "../money.ts";
import { categoryLabel } from "./categories.ts";
import { merchantResolver } from "./merchants.ts";

/** Every action's inverse: restore each touched row as it was before. */
export function restoreInverse(data: Partial<CoreData>, _input: unknown, applied: Mutation[]): Mutation[] {
  return inverseMutations(data, applied);
}

export function requireTx(data: Pick<CoreData, "transactions">, id: string): Transaction {
  const tx = findRow(data, "transactions", { id });
  if (!tx || tx.removed) throw new ActionError(`No transaction ${id}`);
  return tx;
}

export function txLabel(tx: Transaction): string {
  return `${tx.merchantName ?? tx.rawDescription} (${Money.format(tx.amountCents)}, ${tx.authorizedDate ?? tx.date})`;
}

/** The override row for a transaction with `patch` applied (other fields kept). */
export function overrideWith(
  data: Pick<CoreData, "overrides">,
  transactionId: string,
  ctx: ActionContext,
  patch: Partial<Omit<TransactionOverride, "transactionId" | "updatedAt">>,
): Mutation {
  const existing = findRow(data, "overrides", { transactionId });
  const row: TransactionOverride = {
    transactionId,
    category: null,
    bucket: null,
    necessity: null,
    note: null,
    confirmedAt: null,
    ...existing,
    ...patch,
    updatedAt: ctx.now,
  };
  return { op: "upsert", table: "overrides", row };
}

export const ruleMatchSchema = z.object({
  kind: z.enum(["merchant", "description_contains"]),
  /** Merchant key, or text the description contains. Defaults from the transaction. */
  value: z.string().min(1).max(200).optional(),
  /** Limit the rule to this transaction's account. */
  thisAccountOnly: z.boolean().default(false),
});
export type RuleMatchInput = z.infer<typeof ruleMatchSchema>;

/** The merchant key a "merchant" rule uses for this transaction. */
export function merchantKeyOf(data: Pick<CoreData, "merchants" | "merchantAliases">, tx: Transaction): string {
  return merchantResolver(data.merchants, data.merchantAliases).resolve(tx).key;
}

/**
 * A rule upsert that sets one field for transactions matching `match`.
 * Reuses a rule with the same match (so "always" twice doesn't pile up rules)
 * and otherwise adds one ahead of the existing rules (newest wins).
 */
export function ruleWith(
  data: Pick<CoreData, "rules" | "merchants" | "merchantAliases">,
  tx: Transaction,
  match: RuleMatchInput,
  ctx: ActionContext,
  set: { setCategory?: string | null; setBucket?: Bucket | null; setNecessity?: Necessity | null },
): { mutation: Mutation; rule: Rule; description: string } {
  const matchKind: RuleMatchKind = match.kind;
  const matchValue = match.value ?? (match.kind === "merchant" ? merchantKeyOf(data, tx) : tx.rawDescription.trim());
  const accountId = match.thisAccountOnly ? tx.accountId : null;
  const existing = data.rules.find(
    (r) => r.matchKind === matchKind && r.matchValue === matchValue && r.accountId === accountId && r.enabled,
  );
  const rule: Rule = existing
    ? { ...existing, ...set }
    : {
        id: ctx.newId(),
        position: data.rules.length === 0 ? 0 : Math.min(...data.rules.map((r) => r.position)) - 1,
        matchKind,
        matchValue,
        accountId,
        setCategory: null,
        setBucket: null,
        setNecessity: null,
        enabled: true,
        createdAt: ctx.now,
        ...set,
      };
  const what =
    matchKind === "merchant"
      ? `transactions from ${tx.merchantName ?? matchValue.replace(/^auto:/, "")}`
      : `transactions whose description contains "${matchValue}"`;
  return { mutation: { op: "upsert", table: "rules", row: rule }, rule, description: `${what}${accountId ? " on this account" : ""}` };
}

export function bucketLabel(b: Bucket | null): string | null {
  if (b === null) return null;
  return { spending: "Spending", income: "Income", transfer: "Transfer", poker: "Poker" }[b];
}

export function catLabel(c: string | null): string | null {
  return c === null ? null : categoryLabel(c);
}
