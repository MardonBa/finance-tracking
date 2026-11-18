/**
 * Recurring item actions (§9): add one Plaid missed, edit one it got wrong
 * (name, amount, date, account, frequency), remove or restore one, and
 * choose which account pays a credit card.
 *
 * Items I added are edited in place; Plaid's items get an override row so
 * the next sync doesn't overwrite my edit.
 */
import { z } from "zod";
import { ActionError, defineAction, findRow, type Change, type Mutation } from "../../registry.ts";
import { Money } from "../../money.ts";
import { centsSchema, idSchema, isoDateSchema } from "../../schemas.ts";
import { RECURRING_DIRECTIONS, RECURRING_FREQUENCIES, type CoreData, type RecurringItem, type RecurringOverride } from "../../types.ts";
import { accountKind, displayName, isDebtKind } from "../../balances/accountKinds.ts";

const positive = centsSchema.refine((c) => c > 0, { message: "Amount must be more than $0" });

function needItem(data: Pick<CoreData, "recurringItems">, id: string): RecurringItem {
  const item = findRow(data, "recurringItems", { id });
  if (!item) throw new ActionError(`No recurring item ${id}`);
  return item;
}

function needAccountName(data: Pick<CoreData, "accounts">, id: string): string {
  const a = findRow(data, "accounts", { id });
  if (!a) throw new ActionError(`No account ${id}`);
  return displayName(a);
}

function itemName(item: RecurringItem, ov: RecurringOverride | undefined): string {
  return ov?.name ?? item.merchantName ?? item.description;
}

export const addRecurring = defineAction({
  name: "recurring.add",
  description: "Add a recurring charge or income that Plaid missed (name, amount, how often, next date, account).",
  input: z.object({
    accountId: idSchema,
    direction: z.enum(RECURRING_DIRECTIONS).default("outflow"),
    name: z.string().trim().min(1).max(100),
    amountCents: positive,
    frequency: z.enum(RECURRING_FREQUENCIES),
    nextDate: isoDateSchema,
    category: z.string().max(100).nullable().optional(),
  }),
  needs: ["recurringItems", "accounts"],
  examples: [{ accountId: "acc_checking", direction: "outflow", name: "Gym", amountCents: 4500, frequency: "monthly", nextDate: "2026-11-05" }],
  describe(data, input) {
    const acc = needAccountName(data, input.accountId);
    return {
      summary: `Add recurring ${input.direction === "inflow" ? "income" : "charge"} "${input.name}"`,
      changes: [{ label: "Recurring item", before: null, after: `${input.name} · ${Money.format(input.amountCents)} ${input.frequency} · next ${input.nextDate} · ${acc}` }],
    };
  },
  apply(data, input, ctx) {
    needAccountName(data, input.accountId);
    const row: RecurringItem = {
      id: ctx.newId(),
      plaidStreamId: null,
      source: "manual",
      accountId: input.accountId,
      direction: input.direction,
      description: input.name,
      merchantName: null,
      category: input.category ?? null,
      frequency: input.frequency,
      averageAmountCents: input.amountCents,
      lastAmountCents: null,
      lastDate: null,
      predictedNextDate: input.nextDate,
      isActive: true,
      plaidStatus: null,
      firstSeenOn: ctx.today,
    };
    return [{ op: "upsert", table: "recurringItems", row }];
  },
});

const editInput = z.object({
  recurringItemId: idSchema,
  /** For Plaid items, null clears my edit and goes back to Plaid's value. */
  name: z.string().trim().min(1).max(100).nullable().optional(),
  amountCents: positive.nullable().optional(),
  nextDate: isoDateSchema.nullable().optional(),
  accountId: idSchema.nullable().optional(),
  frequency: z.enum(RECURRING_FREQUENCIES).nullable().optional(),
});

export const editRecurring = defineAction({
  name: "recurring.edit",
  description: "Correct a recurring item's name, amount, next date, paying account or frequency.",
  input: editInput,
  needs: ["recurringItems", "recurringOverrides", "accounts"],
  describe(data, input) {
    const item = needItem(data, input.recurringItemId);
    const ov = findRow(data, "recurringOverrides", { recurringItemId: item.id });
    const changes: Change[] = [];
    const amount = ov?.amountCents ?? item.lastAmountCents ?? item.averageAmountCents;
    if (input.name !== undefined) changes.push({ label: "Name", before: itemName(item, ov), after: input.name ?? item.merchantName ?? item.description });
    if (input.amountCents !== undefined) changes.push({ label: "Amount", before: Money.format(Math.abs(amount)), after: input.amountCents === null ? "Plaid's amount" : Money.format(input.amountCents) });
    if (input.nextDate !== undefined) changes.push({ label: "Next date", before: ov?.nextDate ?? item.predictedNextDate, after: input.nextDate ?? item.predictedNextDate });
    if (input.accountId !== undefined) {
      changes.push({ label: "Account", before: needAccountName(data, ov?.accountId ?? item.accountId), after: needAccountName(data, input.accountId ?? item.accountId) });
    }
    if (input.frequency !== undefined) changes.push({ label: "How often", before: ov?.frequency ?? item.frequency, after: input.frequency ?? item.frequency });
    return { summary: `Edit recurring item "${itemName(item, ov)}"`, changes };
  },
  apply(data, input, ctx) {
    const item = needItem(data, input.recurringItemId);
    if (input.accountId) needAccountName(data, input.accountId);
    if (item.source === "manual") {
      const row: RecurringItem = {
        ...item,
        description: input.name ?? item.description,
        averageAmountCents: input.amountCents ?? item.averageAmountCents,
        predictedNextDate: input.nextDate === undefined ? item.predictedNextDate : (input.nextDate ?? item.predictedNextDate),
        accountId: input.accountId ?? item.accountId,
        frequency: input.frequency ?? item.frequency,
      };
      return [{ op: "upsert", table: "recurringItems", row }];
    }
    const ov = findRow(data, "recurringOverrides", { recurringItemId: item.id });
    const pick = <T>(v: T | null | undefined, old: T | null): T | null => (v === undefined ? old : v);
    const row: RecurringOverride = {
      recurringItemId: item.id,
      name: pick(input.name, ov?.name ?? null),
      amountCents: pick(input.amountCents, ov?.amountCents ?? null),
      nextDate: pick(input.nextDate, ov?.nextDate ?? null),
      accountId: pick(input.accountId, ov?.accountId ?? null),
      frequency: pick(input.frequency, ov?.frequency ?? null),
      removed: ov?.removed ?? false,
      updatedAt: ctx.now,
    };
    return [{ op: "upsert", table: "recurringOverrides", row }];
  },
});

export const removeRecurring = defineAction({
  name: "recurring.remove",
  description: "Remove a recurring item from the list and projections (Plaid's items stay hidden so sync doesn't bring them back), or restore it.",
  input: z.object({ recurringItemId: idSchema, removed: z.boolean().default(true) }),
  needs: ["recurringItems", "recurringOverrides", "recurringItemTransactions"],
  describe(data, input) {
    const item = needItem(data, input.recurringItemId);
    const ov = findRow(data, "recurringOverrides", { recurringItemId: item.id });
    return {
      summary: `${input.removed ? "Remove" : "Restore"} recurring item "${itemName(item, ov)}"`,
      changes: [{ label: "In the list", before: ov?.removed ? "no" : "yes", after: input.removed ? "no" : "yes" }],
    };
  },
  apply(data, input, ctx) {
    const item = needItem(data, input.recurringItemId);
    const ov = findRow(data, "recurringOverrides", { recurringItemId: item.id });
    if (item.source === "manual" && input.removed) {
      const muts: Mutation[] = data.recurringItemTransactions
        .filter((l) => l.recurringItemId === item.id)
        .map((l) => ({ op: "delete", table: "recurringItemTransactions", key: { recurringItemId: l.recurringItemId, transactionId: l.transactionId } }));
      if (ov) muts.push({ op: "delete", table: "recurringOverrides", key: { recurringItemId: item.id } });
      muts.push({ op: "delete", table: "recurringItems", key: { id: item.id } });
      return muts;
    }
    const row: RecurringOverride = {
      recurringItemId: item.id,
      name: ov?.name ?? null,
      amountCents: ov?.amountCents ?? null,
      nextDate: ov?.nextDate ?? null,
      accountId: ov?.accountId ?? null,
      frequency: ov?.frequency ?? null,
      removed: input.removed,
      updatedAt: ctx.now,
    };
    return [{ op: "upsert", table: "recurringOverrides", row }];
  },
});

export const setCardPayingAccount = defineAction({
  name: "recurring.setCardPayingAccount",
  description: "Choose which account pays a credit card's statement, so the payment shows in that account's upcoming view.",
  input: z.object({ cardAccountId: idSchema, payingAccountId: idSchema.nullable() }),
  needs: ["liabilities", "accounts"],
  examples: [{ cardAccountId: "acc_card", payingAccountId: "acc_hysa" }, { cardAccountId: "acc_card", payingAccountId: null }],
  describe(data, input) {
    const card = needAccountName(data, input.cardAccountId);
    const l = findRow(data, "liabilities", { accountId: input.cardAccountId });
    return {
      summary: `Pay ${card} from ${input.payingAccountId ? needAccountName(data, input.payingAccountId) : "no account"}`,
      changes: [
        {
          label: "Paid from",
          before: l?.payingAccountId ? needAccountName(data, l.payingAccountId) : null,
          after: input.payingAccountId ? needAccountName(data, input.payingAccountId) : null,
        },
      ],
    };
  },
  apply(data, input, ctx) {
    const card = findRow(data, "accounts", { id: input.cardAccountId });
    if (!card || !isDebtKind(accountKind(card))) throw new ActionError(`${input.cardAccountId} is not a credit card or loan account.`);
    if (input.payingAccountId) needAccountName(data, input.payingAccountId);
    const l = findRow(data, "liabilities", { accountId: input.cardAccountId });
    const row = l
      ? { ...l, payingAccountId: input.payingAccountId }
      : {
          accountId: input.cardAccountId,
          lastStatementBalanceCents: null,
          lastStatementIssueDate: null,
          nextPaymentDueDate: null,
          minimumPaymentCents: null,
          payingAccountId: input.payingAccountId,
          updatedAt: ctx.now,
        };
    return [{ op: "upsert", table: "liabilities", row }];
  },
});

export const recurringActions = [addRecurring, editRecurring, removeRecurring, setCardPayingAccount];
