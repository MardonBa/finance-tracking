/**
 * Account actions (§3, §11, decision 005): rename, hide, retype, protected
 * amount, and manual cash accounts with hand-entered transactions. A manual
 * account's balance is always derived from its transactions; its starting
 * balance is an opening transaction with id `<accountId>__opening`.
 */
import { z } from "zod";
import { ActionError, defineAction, findRow, type Mutation } from "../../registry.ts";
import { Money, type Cents } from "../../money.ts";
import { centsSchema, idSchema, isoDateSchema } from "../../schemas.ts";
import { ACCOUNT_KINDS, type Account, type CoreData, type Transaction, type TransactionOverride } from "../../types.ts";
import { accountKind, displayName } from "../../balances/accountKinds.ts";
import { activeGoals } from "../../goals/allocation.ts";
import { explainGoalChanges } from "../../goals/explain.ts";

export const OPENING_SUFFIX = "__opening";
export const openingTransactionId = (accountId: string) => `${accountId}${OPENING_SUFFIX}`;

function needAccount(data: Pick<CoreData, "accounts">, accountId: string): Account {
  const a = findRow(data, "accounts", { id: accountId });
  if (!a) throw new ActionError(`No account ${accountId}`);
  return a;
}

function needManual(data: Pick<CoreData, "accounts">, accountId: string): Account {
  const a = needAccount(data, accountId);
  if (!a.isManual) throw new ActionError(`${displayName(a)} is connected through the bank; only manual accounts are edited by hand.`);
  return a;
}

/** Balance of a manual account = the sum of its cleared, not-removed transactions. */
export function derivedBalance(transactions: readonly Transaction[], accountId: string): Cents {
  return Money.sum(transactions.filter((t) => t.accountId === accountId && !t.pending && !t.removed).map((t) => t.amountCents));
}

function withBalance(account: Account, transactions: readonly Transaction[], now: string): Mutation {
  return { op: "upsert", table: "accounts", row: { ...account, currentBalanceCents: derivedBalance(transactions, account.id), balanceUpdatedAt: now } };
}

function manualTransaction(fields: { id: string; accountId: string; amountCents: Cents; date: string; description: string; merchantName: string | null }, now: string): Transaction {
  return {
    id: fields.id,
    plaidTransactionId: null,
    accountId: fields.accountId,
    amountCents: fields.amountCents,
    isoCurrencyCode: "USD",
    date: fields.date,
    authorizedDate: null,
    pending: false,
    pendingTransactionId: null,
    rawDescription: fields.description,
    merchantName: fields.merchantName,
    merchantEntityId: null,
    plaidCategoryPrimary: null,
    plaidCategoryDetailed: null,
    plaidCategoryConfidence: null,
    isManual: true,
    removed: false,
    removedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** The opening balance is neither spending nor income: a confirmed transfer-bucket override. */
function openingOverride(transactionId: string, now: string): TransactionOverride {
  return { transactionId, category: null, bucket: "transfer", necessity: null, note: "Starting balance", confirmedAt: now, updatedAt: now };
}

// ---------------------------------------------------------------- rename / hide / retype

export const renameAccount = defineAction({
  name: "accounts.rename",
  description: "Give an account a nickname, or clear it to show the bank's name.",
  input: z.object({ accountId: idSchema, nickname: z.string().trim().min(1).max(60).nullable() }),
  needs: ["accounts"],
  examples: [{ accountId: "acc_checking", nickname: "Everyday" }, { accountId: "acc_checking", nickname: null }],
  describe(data, input) {
    const a = needAccount(data, input.accountId);
    return { summary: `Rename ${displayName(a)}`, changes: [{ label: "Name", before: displayName(a), after: input.nickname ?? a.name }] };
  },
  apply(data, input) {
    return [{ op: "upsert", table: "accounts", row: { ...needAccount(data, input.accountId), nickname: input.nickname } }];
  },
});

export const setAccountHidden = defineAction({
  name: "accounts.setHidden",
  description: "Hide an account from views (or show it again).",
  input: z.object({ accountId: idSchema, hidden: z.boolean() }),
  needs: ["accounts"],
  examples: [{ accountId: "acc_cash", hidden: true }],
  describe(data, input) {
    const a = needAccount(data, input.accountId);
    return { summary: `${input.hidden ? "Hide" : "Show"} ${displayName(a)}`, changes: [{ label: "Hidden", before: a.hidden ? "yes" : "no", after: input.hidden ? "yes" : "no" }] };
  },
  apply(data, input) {
    return [{ op: "upsert", table: "accounts", row: { ...needAccount(data, input.accountId), hidden: input.hidden } }];
  },
});

export const retypeAccount = defineAction({
  name: "accounts.retype",
  description: "Fix an account's type when the bank got it wrong (checking, savings, credit, investment, loan, cash, other), or clear the fix.",
  input: z.object({ accountId: idSchema, kind: z.enum(ACCOUNT_KINDS).nullable() }),
  needs: ["accounts"],
  examples: [{ accountId: "acc_hysa", kind: "checking" }],
  describe(data, input) {
    const a = needAccount(data, input.accountId);
    const after = accountKind({ ...a, kindOverride: input.kind });
    return { summary: `Change the type of ${displayName(a)}`, changes: [{ label: "Type", before: accountKind(a), after }] };
  },
  apply(data, input) {
    return [{ op: "upsert", table: "accounts", row: { ...needAccount(data, input.accountId), kindOverride: input.kind } }];
  },
});

export const setProtectedAmount = defineAction({
  name: "accounts.setProtectedAmount",
  description: "Set the protected amount (e.g. an emergency fund) of an account; it is filled before any goal.",
  input: z.object({ accountId: idSchema, protectedAmountCents: centsSchema.refine((c) => c >= 0, { message: "Can't be negative" }) }),
  needs: ["accounts", "goals"],
  examples: [{ accountId: "acc_hysa", protectedAmountCents: 600000 }],
  describe(data, input) {
    const a = needAccount(data, input.accountId);
    const goals = activeGoals(data.goals).filter((g) => g.accountId === a.id);
    const balance = a.currentBalanceCents ?? 0;
    const moves = explainGoalChanges(
      { balanceCents: balance, protectedCents: a.protectedAmountCents, goals },
      { balanceCents: balance, protectedCents: input.protectedAmountCents, goals },
    )
      .filter((c) => c.changeCents !== 0)
      .map((c) => ({ label: `${c.name} (money assigned)`, before: Money.format(c.beforeCents), after: Money.format(c.afterCents) }));
    return {
      summary: `Set the protected amount of ${displayName(a)} to ${Money.format(input.protectedAmountCents)}`,
      changes: [{ label: "Protected amount", before: Money.format(a.protectedAmountCents), after: Money.format(input.protectedAmountCents) }, ...moves],
    };
  },
  apply(data, input) {
    return [{ op: "upsert", table: "accounts", row: { ...needAccount(data, input.accountId), protectedAmountCents: input.protectedAmountCents } }];
  },
});

// ---------------------------------------------------------------- manual accounts

export const addManualAccount = defineAction({
  name: "accounts.addManualAccount",
  description: "Add a manual account (e.g. cash) with an optional starting balance; its balance comes from its transactions.",
  input: z.object({
    name: z.string().trim().min(1).max(60),
    kind: z.enum(ACCOUNT_KINDS).default("cash"),
    startingBalanceCents: centsSchema.default(0),
    startingDate: isoDateSchema.optional(),
  }),
  needs: ["accounts", "transactions", "overrides"],
  examples: [{ name: "Wallet", kind: "cash", startingBalanceCents: 4000 }, { name: "Jar", kind: "cash", startingBalanceCents: 0 }],
  describe(_data, input) {
    return {
      summary: `Add manual account "${input.name}"`,
      changes: [
        { label: "Account", before: null, after: `${input.name} (${input.kind})` },
        { label: "Starting balance", before: null, after: Money.format(input.startingBalanceCents) },
      ],
    };
  },
  apply(_data, input, ctx) {
    const id = ctx.newId();
    const date = input.startingDate ?? ctx.today;
    const account: Account = {
      id,
      itemId: null,
      plaidAccountId: null,
      name: input.name,
      nickname: null,
      mask: null,
      type: "other",
      subtype: null,
      kindOverride: input.kind,
      isManual: true,
      hidden: false,
      protectedAmountCents: 0,
      incomeFallback: false,
      isoCurrencyCode: "USD",
      currentBalanceCents: input.startingBalanceCents,
      balanceUpdatedAt: ctx.now,
      connectedOn: date,
      createdAt: ctx.now,
    };
    const muts: Mutation[] = [{ op: "upsert", table: "accounts", row: account }];
    if (input.startingBalanceCents !== 0) {
      const tid = openingTransactionId(id);
      muts.push({ op: "upsert", table: "transactions", row: manualTransaction({ id: tid, accountId: id, amountCents: input.startingBalanceCents, date, description: "Starting balance", merchantName: null }, ctx.now) });
      muts.push({ op: "upsert", table: "overrides", row: openingOverride(tid, ctx.now) });
    }
    return muts;
  },
});

/** Every row that refers to a transaction, so deleting it leaves nothing dangling. */
function deleteTransactionRows(
  data: Pick<CoreData, "overrides" | "transactionTags" | "splits" | "transferLinks" | "refundLinks" | "recurringItemTransactions">,
  transactionId: string,
): Mutation[] {
  const muts: Mutation[] = [];
  for (const o of data.overrides.filter((x) => x.transactionId === transactionId)) muts.push({ op: "delete", table: "overrides", key: { transactionId: o.transactionId } });
  for (const t of data.transactionTags.filter((x) => x.transactionId === transactionId)) muts.push({ op: "delete", table: "transactionTags", key: { transactionId: t.transactionId, tagId: t.tagId } });
  for (const s of data.splits.filter((x) => x.transactionId === transactionId)) muts.push({ op: "delete", table: "splits", key: { id: s.id } });
  for (const l of data.transferLinks.filter((x) => x.inTransactionId === transactionId || x.outTransactionId === transactionId)) muts.push({ op: "delete", table: "transferLinks", key: { id: l.id } });
  for (const l of data.refundLinks.filter((x) => x.refundTransactionId === transactionId || x.purchaseTransactionId === transactionId)) muts.push({ op: "delete", table: "refundLinks", key: { id: l.id } });
  for (const r of data.recurringItemTransactions.filter((x) => x.transactionId === transactionId)) muts.push({ op: "delete", table: "recurringItemTransactions", key: { recurringItemId: r.recurringItemId, transactionId } });
  muts.push({ op: "delete", table: "transactions", key: { id: transactionId } });
  return muts;
}

const LINKED_SLICES = ["overrides", "transactionTags", "splits", "transferLinks", "refundLinks", "recurringItemTransactions"] as const;

export const deleteManualAccount = defineAction({
  name: "accounts.deleteManualAccount",
  description: "Delete a manual account together with its hand-entered transactions and snapshots.",
  input: z.object({ accountId: idSchema }),
  needs: ["accounts", "transactions", "goals", "balanceSnapshots", ...LINKED_SLICES],
  examples: [{ accountId: "acc_cash" }],
  describe(data, input) {
    const a = needManual(data, input.accountId);
    const n = data.transactions.filter((t) => t.accountId === a.id).length;
    return {
      summary: `Delete manual account ${displayName(a)} and its ${n} transaction(s)`,
      changes: [{ label: "Account", before: `${displayName(a)} · ${Money.format(a.currentBalanceCents ?? 0)}`, after: null }],
    };
  },
  apply(data, input) {
    const a = needManual(data, input.accountId);
    if (data.goals.some((g) => g.accountId === a.id)) throw new ActionError(`Move or delete the goals in ${displayName(a)} first.`);
    const muts: Mutation[] = data.transactions.filter((t) => t.accountId === a.id).flatMap((t) => deleteTransactionRows(data, t.id));
    for (const s of data.balanceSnapshots.filter((x) => x.accountId === a.id)) muts.push({ op: "delete", table: "balanceSnapshots", key: { accountId: s.accountId, date: s.date } });
    muts.push({ op: "delete", table: "accounts", key: { id: a.id } });
    return muts;
  },
});

export const setStartingBalance = defineAction({
  name: "accounts.setStartingBalance",
  description: "Set the starting balance (and its date) of a manual account; the balance is recomputed from its transactions.",
  input: z.object({ accountId: idSchema, startingBalanceCents: centsSchema, date: isoDateSchema.optional() }),
  needs: ["accounts", "transactions", "overrides"],
  examples: [{ accountId: "acc_cash", startingBalanceCents: 2500, date: "2026-09-01" }],
  describe(data, input) {
    const a = needManual(data, input.accountId);
    const opening = findRow(data, "transactions", { id: openingTransactionId(a.id) });
    const muts = this.apply(data, input, { today: input.date ?? a.connectedOn, now: "", newId: () => "" });
    const acc = muts.find((m) => m.table === "accounts");
    const after = acc && acc.op === "upsert" ? (acc.row as Account).currentBalanceCents : null;
    return {
      summary: `Set the starting balance of ${displayName(a)} to ${Money.format(input.startingBalanceCents)}`,
      changes: [
        { label: "Starting balance", before: Money.format(opening?.amountCents ?? 0), after: Money.format(input.startingBalanceCents) },
        { label: "Balance", before: Money.format(a.currentBalanceCents ?? 0), after: Money.format(after ?? 0) },
      ],
    };
  },
  apply(data, input, ctx) {
    const a = needManual(data, input.accountId);
    const tid = openingTransactionId(a.id);
    const existing = findRow(data, "transactions", { id: tid });
    const date = input.date ?? existing?.date ?? a.connectedOn;
    const muts: Mutation[] = [];
    let txs: Transaction[];
    if (input.startingBalanceCents === 0) {
      if (existing) {
        muts.push(...deleteTransactionRows({ ...emptyLinked(), overrides: data.overrides }, tid));
      }
      txs = data.transactions.filter((t) => t.id !== tid);
    } else {
      const row = existing
        ? { ...existing, amountCents: input.startingBalanceCents, date, updatedAt: ctx.now }
        : manualTransaction({ id: tid, accountId: a.id, amountCents: input.startingBalanceCents, date, description: "Starting balance", merchantName: null }, ctx.now);
      muts.push({ op: "upsert", table: "transactions", row });
      if (!findRow(data, "overrides", { transactionId: tid })) muts.push({ op: "upsert", table: "overrides", row: openingOverride(tid, ctx.now) });
      txs = [...data.transactions.filter((t) => t.id !== tid), row];
    }
    muts.push(withBalance(a, txs, ctx.now));
    return muts;
  },
});

function emptyLinked() {
  return { overrides: [], transactionTags: [], splits: [], transferLinks: [], refundLinks: [], recurringItemTransactions: [] };
}

const manualTxFields = {
  amountCents: centsSchema.refine((c) => c !== 0, { message: "Amount can't be $0" }),
  date: isoDateSchema,
  description: z.string().trim().min(1).max(200),
  merchantName: z.string().trim().min(1).max(100).nullable().optional(),
};

export const addManualTransaction = defineAction({
  name: "accounts.addManualTransaction",
  description: "Add a hand-entered transaction to a manual account (positive = money in, negative = money out).",
  input: z.object({ accountId: idSchema, ...manualTxFields }),
  needs: ["accounts", "transactions"],
  examples: [{ accountId: "acc_cash", amountCents: -1200, date: "2026-10-20", description: "Farmers market", merchantName: "Farmers market" }],
  describe(data, input) {
    const a = needManual(data, input.accountId);
    return {
      summary: `Add ${Money.format(input.amountCents)} "${input.description}" to ${displayName(a)}`,
      changes: [
        { label: "Transaction", before: null, after: `${input.date} · ${input.description} · ${Money.format(input.amountCents)}` },
        { label: "Balance", before: Money.format(a.currentBalanceCents ?? 0), after: Money.format(derivedBalance(data.transactions, a.id) + input.amountCents) },
      ],
    };
  },
  apply(data, input, ctx) {
    const a = needManual(data, input.accountId);
    const row = manualTransaction({ id: ctx.newId(), accountId: a.id, amountCents: input.amountCents, date: input.date, description: input.description, merchantName: input.merchantName ?? null }, ctx.now);
    return [{ op: "upsert", table: "transactions", row }, withBalance(a, [...data.transactions, row], ctx.now)];
  },
});

function needManualTx(data: Pick<CoreData, "transactions" | "accounts">, transactionId: string): { tx: Transaction; account: Account } {
  const tx = findRow(data, "transactions", { id: transactionId });
  if (!tx) throw new ActionError(`No transaction ${transactionId}`);
  const account = needManual(data, tx.accountId);
  if (!tx.isManual) throw new ActionError("Only hand-entered transactions can be edited here.");
  return { tx, account };
}

export const editManualTransaction = defineAction({
  name: "accounts.editManualTransaction",
  description: "Edit a hand-entered transaction in a manual account (amount, date, description, merchant).",
  input: z.object({
    transactionId: idSchema,
    amountCents: manualTxFields.amountCents.optional(),
    date: isoDateSchema.optional(),
    description: manualTxFields.description.optional(),
    merchantName: z.string().trim().min(1).max(100).nullable().optional(),
  }),
  needs: ["accounts", "transactions"],
  examples: [{ transactionId: "tx_cash_in", amountCents: 8000 }],
  describe(data, input) {
    const { tx, account } = needManualTx(data, input.transactionId);
    const changes = [];
    if (input.amountCents !== undefined) changes.push({ label: "Amount", before: Money.format(tx.amountCents), after: Money.format(input.amountCents) });
    if (input.date !== undefined) changes.push({ label: "Date", before: tx.date, after: input.date });
    if (input.description !== undefined) changes.push({ label: "Description", before: tx.rawDescription, after: input.description });
    if (input.merchantName !== undefined) changes.push({ label: "Merchant", before: tx.merchantName, after: input.merchantName });
    if (input.amountCents !== undefined) {
      changes.push({ label: "Balance", before: Money.format(account.currentBalanceCents ?? 0), after: Money.format(derivedBalance(data.transactions, account.id) - tx.amountCents + input.amountCents) });
    }
    return { summary: `Edit "${tx.rawDescription}" in ${displayName(account)}`, changes };
  },
  apply(data, input, ctx) {
    const { tx, account } = needManualTx(data, input.transactionId);
    const row: Transaction = {
      ...tx,
      amountCents: input.amountCents ?? tx.amountCents,
      date: input.date ?? tx.date,
      rawDescription: input.description ?? tx.rawDescription,
      merchantName: input.merchantName === undefined ? tx.merchantName : input.merchantName,
      updatedAt: ctx.now,
    };
    return [{ op: "upsert", table: "transactions", row }, withBalance(account, data.transactions.map((t) => (t.id === row.id ? row : t)), ctx.now)];
  },
});

export const deleteManualTransaction = defineAction({
  name: "accounts.deleteManualTransaction",
  description: "Delete a hand-entered transaction from a manual account (and its notes, tags, splits and links).",
  input: z.object({ transactionId: idSchema }),
  needs: ["accounts", "transactions", ...LINKED_SLICES],
  examples: [{ transactionId: "tx_cash_in" }],
  describe(data, input) {
    const { tx, account } = needManualTx(data, input.transactionId);
    return {
      summary: `Delete "${tx.rawDescription}" (${Money.format(tx.amountCents)}) from ${displayName(account)}`,
      changes: [
        { label: "Transaction", before: `${tx.date} · ${tx.rawDescription} · ${Money.format(tx.amountCents)}`, after: null },
        { label: "Balance", before: Money.format(account.currentBalanceCents ?? 0), after: Money.format(derivedBalance(data.transactions, account.id) - tx.amountCents) },
      ],
    };
  },
  apply(data, input, ctx) {
    const { tx, account } = needManualTx(data, input.transactionId);
    return [...deleteTransactionRows(data, tx.id), withBalance(account, data.transactions.filter((t) => t.id !== tx.id), ctx.now)];
  },
});

export const accountActions = [
  renameAccount,
  setAccountHidden,
  retypeAccount,
  setProtectedAmount,
  addManualAccount,
  deleteManualAccount,
  setStartingBalance,
  addManualTransaction,
  editManualTransaction,
  deleteManualTransaction,
];
