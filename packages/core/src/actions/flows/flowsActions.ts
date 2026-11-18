import { z } from "zod";
import { ActionError, applyMutations, defineAction, findRow, type ActionDef, type Mutation } from "../../registry.ts";
import { BUCKETS, type Bucket, type RefundLink, type TransferLink } from "../../types.ts";
import { Money } from "../../money.ts";
import { idSchema } from "../../schemas.ts";
import { LEDGER_NEEDS, buildLedger, type LedgerData } from "../../flows/ledger.ts";
import { refundableCents } from "../../flows/refunds.ts";
import { transferLabel } from "../../flows/rows.ts";
import { autoTransferLinkId } from "../../flows/transfers.ts";
import {
  bucketLabel,
  overrideWith,
  requireTx,
  restoreInverse,
  ruleMatchSchema,
  ruleWith,
  txLabel,
} from "../../flows/actionHelpers.ts";

type LedgerKey = (typeof LEDGER_NEEDS)[number];

const bucketOf = (data: LedgerData, id: string): Bucket | null => buildLedger(data).byTransaction.get(id)?.[0]?.bucket ?? null;

// ---------------------------------------------------------------- set bucket (income / not income, …)

const setBucketInput = z.object({
    transactionId: idSchema,
    bucket: z.enum(BUCKETS).nullable(),
    always: ruleMatchSchema.optional(),
  });

export const setBucket: ActionDef<typeof setBucketInput, LedgerKey> = defineAction({
  name: "flows.setBucket",
  description:
    "Say what one transaction is (spending, income, transfer or Poker), or clear the fix; optionally always do this for matching transactions (a payer rule).",
  input: setBucketInput,
  needs: LEDGER_NEEDS,
  examples: [
    { transactionId: "tx_paycheck", bucket: "income", always: { kind: "description_contains", value: "ACME CORP PAYROLL", thisAccountOnly: false } },
    { transactionId: "tx_refund_amazon", bucket: null },
  ],
  describe(data, input, ctx) {
    const tx = requireTx(data, input.transactionId);
    const after = applyMutations(data, setBucket.apply(data, input, ctx));
    const changes = [{ label: "Counts as", before: bucketLabel(bucketOf(data, tx.id)), after: bucketLabel(bucketOf(after, tx.id)) }];
    if (input.always && input.bucket) {
      const r = ruleWith(data, tx, input.always, ctx, { setBucket: input.bucket });
      changes.push({ label: "Rule", before: null, after: `Always count ${r.description} as ${bucketLabel(input.bucket)}` });
    }
    return { summary: `${input.bucket ? `Count ${txLabel(tx)} as ${bucketLabel(input.bucket)}` : `Clear the fix on ${txLabel(tx)}`}`, changes };
  },
  apply(data, input, ctx) {
    const tx = requireTx(data, input.transactionId);
    const muts: Mutation[] = [overrideWith(data, tx.id, ctx, { bucket: input.bucket, confirmedAt: input.bucket ? ctx.now : null })];
    if (input.always && input.bucket) muts.push(ruleWith(data, tx, input.always, ctx, { setBucket: input.bucket }).mutation);
    return muts;
  },
  inverse: restoreInverse,
});

// ---------------------------------------------------------------- transfers

const markTransferInput = z.object({
    transactionId: idSchema,
    counterpartTransactionId: idSchema.optional(),
    always: ruleMatchSchema.optional(),
  });

export const markTransfer: ActionDef<typeof markTransferInput, LedgerKey> = defineAction({
  name: "flows.markTransfer",
  description:
    "Mark a transaction as a transfer between my own accounts, optionally pairing it with its other half, and optionally always treating matching transactions as transfers.",
  input: markTransferInput,
  needs: LEDGER_NEEDS,
  examples: [
    { transactionId: "tx_poker_out" },
    { transactionId: "tx_refund_amazon", always: { kind: "merchant", thisAccountOnly: true } },
  ],
  describe(data, input, ctx) {
    const tx = requireTx(data, input.transactionId);
    const after = applyMutations(data, markTransfer.apply(data, input, ctx));
    const changes = [{ label: "Counts as", before: bucketLabel(bucketOf(data, tx.id)), after: bucketLabel(bucketOf(after, tx.id)) }];
    if (input.counterpartTransactionId) {
      const ledger = buildLedger(after);
      const e = ledger.byTransaction.get(tx.id)?.[0];
      changes.push({ label: "Matched with", before: null, after: e ? transferLabel(ledger, e) : null });
    }
    if (input.always) {
      changes.push({ label: "Rule", before: null, after: `Always treat ${ruleWith(data, tx, input.always, ctx, { setBucket: "transfer" }).description} as transfers` });
    }
    return { summary: `Mark ${txLabel(tx)} as a transfer`, changes };
  },
  apply(data, input, ctx) {
    const tx = requireTx(data, input.transactionId);
    const muts: Mutation[] = [];
    if (input.counterpartTransactionId) {
      const other = requireTx(data, input.counterpartTransactionId);
      if (other.id === tx.id) throw new ActionError("A transfer needs two different transactions");
      if (Math.sign(other.amountCents) === Math.sign(tx.amountCents) || other.amountCents === 0 || tx.amountCents === 0) {
        throw new ActionError("The two halves of a transfer must go in opposite directions");
      }
      if (other.amountCents + tx.amountCents !== 0) {
        throw new ActionError(`The two halves must be the same amount (${Money.format(tx.amountCents)} vs ${Money.format(other.amountCents)})`);
      }
      // Undo any active link either half is in.
      for (const l of data.transferLinks) {
        if (l.undoneAt !== null) continue;
        if ([l.outTransactionId, l.inTransactionId].some((id) => id === tx.id || id === other.id)) {
          muts.push({ op: "upsert", table: "transferLinks", row: { ...l, undoneAt: ctx.now } });
        }
      }
      const [out, inn] = tx.amountCents < 0 ? [tx, other] : [other, tx];
      const link: TransferLink = {
        id: ctx.newId(),
        outTransactionId: out.id,
        inTransactionId: inn.id,
        source: "manual",
        undoneAt: null,
        needsReview: false,
        createdAt: ctx.now,
      };
      muts.push({ op: "upsert", table: "transferLinks", row: link });
      for (const t of [tx, other]) {
        const o = findRow(data, "overrides", { transactionId: t.id });
        if (o?.bucket && o.bucket !== "transfer") muts.push(overrideWith(data, t.id, ctx, { bucket: null }));
      }
    } else {
      muts.push(overrideWith(data, tx.id, ctx, { bucket: "transfer", confirmedAt: ctx.now }));
    }
    if (input.always) muts.push(ruleWith(data, tx, input.always, ctx, { setBucket: "transfer" }).mutation);
    return muts;
  },
  inverse: restoreInverse,
});

const unmarkTransferInput = z.object({
    transactionId: idSchema,
    /** What it is instead, if it would still look like a transfer. TODO(revisit): default spending. */
    countAs: z.enum(["spending", "income", "poker"]).default("spending"),
  });

export const unmarkTransfer: ActionDef<typeof unmarkTransferInput, LedgerKey> = defineAction({
  name: "flows.unmarkTransfer",
  description:
    "Undo a transfer: unmatch an automatic or manual pair (e.g. a coincidental $50 out and $50 in), and stop counting the transaction as a transfer.",
  input: unmarkTransferInput,
  needs: LEDGER_NEEDS,
  examples: [
    { transactionId: "tx_transfer_out_hysa", countAs: "spending" },
    { transactionId: "tx_cash_in", countAs: "spending" },
  ],
  describe(data, input, ctx) {
    const tx = requireTx(data, input.transactionId);
    const before = buildLedger(data);
    const e = before.byTransaction.get(tx.id)?.[0];
    const after = applyMutations(data, unmarkTransfer.apply(data, input, ctx));
    const changes = [{ label: "Counts as", before: bucketLabel(e?.bucket ?? null), after: bucketLabel(bucketOf(after, tx.id)) }];
    if (e?.transferCounterpartId) changes.push({ label: "Match", before: transferLabel(before, e), after: null });
    return { summary: `Stop treating ${txLabel(tx)} as a transfer`, changes };
  },
  apply(data, input, ctx) {
    const tx = requireTx(data, input.transactionId);
    const ledger = buildLedger(data);
    const e = ledger.byTransaction.get(tx.id)?.[0];
    if (!e || e.bucket !== "transfer") throw new ActionError(`${txLabel(tx)} is not counted as a transfer`);
    const muts: Mutation[] = [];
    if (e.transferLinkId) {
      const link = ledger.transferLinks.find((l) => l.id === e.transferLinkId)!;
      const stored = findRow(data, "transferLinks", { id: link.id });
      // An automatic match not stored yet is stored as undone, so it isn't matched again.
      const id = stored ? link.id : autoTransferLinkId(link.outTransactionId, link.inTransactionId);
      muts.push({ op: "upsert", table: "transferLinks", row: { ...link, id, undoneAt: ctx.now } });
    }
    const o = findRow(data, "overrides", { transactionId: tx.id });
    if (o?.bucket === "transfer") muts.push(overrideWith(data, tx.id, ctx, { bucket: null }));
    // Still a transfer (Plaid's label or a rule)? Then the user's word wins.
    if (bucketOf(applyMutations(data, muts), tx.id) === "transfer") {
      muts.push(overrideWith(applyMutations(data, muts), tx.id, ctx, { bucket: input.countAs, confirmedAt: ctx.now }));
    }
    return muts;
  },
  inverse: restoreInverse,
});

// ---------------------------------------------------------------- refunds

export const linkRefund = defineAction({
  name: "flows.linkRefund",
  description:
    "Link a refund to the purchase it refunds, so it counts in the purchase's period and category (it can't reduce the purchase below zero).",
  input: z.object({ refundTransactionId: idSchema, purchaseTransactionId: idSchema }),
  needs: LEDGER_NEEDS,
  examples: [{ refundTransactionId: "tx_refund_amazon", purchaseTransactionId: "tx_card_purchase_amazon" }],
  describe(data, input) {
    const refund = requireTx(data, input.refundTransactionId);
    const purchase = requireTx(data, input.purchaseTransactionId);
    const current = data.refundLinks.find((l) => l.refundTransactionId === refund.id && l.undoneAt === null);
    const currentTx = current ? findRow(data, "transactions", { id: current.purchaseTransactionId }) : undefined;
    return {
      summary: `Link the ${Money.format(refund.amountCents)} refund to ${txLabel(purchase)}`,
      changes: [
        { label: "Refund of", before: currentTx ? txLabel(currentTx) : null, after: txLabel(purchase) },
        { label: "Counts in", before: refund.authorizedDate ?? refund.date, after: purchase.authorizedDate ?? purchase.date },
      ],
    };
  },
  apply(data, input, ctx) {
    const refund = requireTx(data, input.refundTransactionId);
    const purchase = requireTx(data, input.purchaseTransactionId);
    if (refund.amountCents <= 0) throw new ActionError("A refund is money coming in");
    if (purchase.amountCents >= 0) throw new ActionError("A refund can only be linked to a purchase (money going out)");
    const muts: Mutation[] = [];
    let base = data;
    for (const l of data.refundLinks) {
      if (l.refundTransactionId === refund.id && l.undoneAt === null) {
        if (l.purchaseTransactionId === purchase.id) return [];
        muts.push({ op: "upsert", table: "refundLinks", row: { ...l, undoneAt: ctx.now } });
      }
    }
    base = applyMutations(data, muts);
    const left = refundableCents(buildLedger(base), purchase.id);
    if (refund.amountCents > left) {
      throw new ActionError(
        `That would reduce the purchase below zero: ${Money.format(refund.amountCents)} refund, ${Money.format(left)} left to refund`,
      );
    }
    const link: RefundLink = {
      id: ctx.newId(),
      refundTransactionId: refund.id,
      purchaseTransactionId: purchase.id,
      source: "manual",
      undoneAt: null,
      needsReview: false,
      createdAt: ctx.now,
    };
    muts.push({ op: "upsert", table: "refundLinks", row: link });
    return muts;
  },
  inverse: restoreInverse,
});

export const unlinkRefund = defineAction({
  name: "flows.unlinkRefund",
  description: "Unlink a refund from its purchase; it then counts in the period it arrived, in its own category.",
  input: z.object({ refundTransactionId: idSchema }),
  needs: ["transactions", "refundLinks"],
  examples: [{ refundTransactionId: "tx_refund_amazon" }],
  describe(data, input) {
    const refund = requireTx(data, input.refundTransactionId);
    const l = data.refundLinks.find((x) => x.refundTransactionId === refund.id && x.undoneAt === null);
    const p = l ? findRow(data, "transactions", { id: l.purchaseTransactionId }) : undefined;
    return {
      summary: `Unlink the ${Money.format(refund.amountCents)} refund`,
      changes: [{ label: "Refund of", before: p ? txLabel(p) : null, after: null }],
    };
  },
  apply(data, input, ctx) {
    requireTx(data, input.refundTransactionId);
    const active = data.refundLinks.filter((l) => l.refundTransactionId === input.refundTransactionId && l.undoneAt === null);
    if (active.length === 0) throw new ActionError("This refund isn't linked to a purchase");
    return active.map((l): Mutation => ({ op: "upsert", table: "refundLinks", row: { ...l, undoneAt: ctx.now } }));
  },
  inverse: restoreInverse,
});

// ---------------------------------------------------------------- Poker

const markPokerInput = z.object({
    transactionId: idSchema,
    poker: z.boolean(),
    always: ruleMatchSchema.optional(),
  });

export const markPoker: ActionDef<typeof markPokerInput, LedgerKey> = defineAction({
  name: "flows.markPoker",
  description:
    "Mark (or unmark) a transaction as Poker banking, optionally always for this payer or payee. Poker stays out of spending and income; its net counts as income.",
  input: markPokerInput,
  needs: LEDGER_NEEDS,
  examples: [
    { transactionId: "tx_poker_out", poker: false },
    { transactionId: "tx_card_purchase_dining", poker: true, always: { kind: "description_contains", value: "VENMO PAYMENT TO SAM", thisAccountOnly: false } },
  ],
  describe(data, input, ctx) {
    const tx = requireTx(data, input.transactionId);
    const after = applyMutations(data, markPoker.apply(data, input, ctx));
    const changes = [{ label: "Counts as", before: bucketLabel(bucketOf(data, tx.id)), after: bucketLabel(bucketOf(after, tx.id)) }];
    if (input.poker && input.always) {
      changes.push({ label: "Rule", before: null, after: `Always count ${ruleWith(data, tx, input.always, ctx, { setBucket: "poker" }).description} as Poker` });
    }
    return { summary: `${input.poker ? "Mark" : "Unmark"} ${txLabel(tx)} as Poker`, changes };
  },
  apply(data, input, ctx) {
    const tx = requireTx(data, input.transactionId);
    if (input.poker) {
      const muts: Mutation[] = [overrideWith(data, tx.id, ctx, { bucket: "poker", confirmedAt: ctx.now })];
      if (input.always) muts.push(ruleWith(data, tx, input.always, ctx, { setBucket: "poker" }).mutation);
      return muts;
    }
    const muts: Mutation[] = [overrideWith(data, tx.id, ctx, { bucket: null })];
    // Still Poker through a rule? Then the per-transaction fix says otherwise.
    if (bucketOf(applyMutations(data, muts), tx.id) === "poker") {
      muts.splice(0, 1, overrideWith(data, tx.id, ctx, { bucket: "spending", confirmedAt: ctx.now }));
    }
    return muts;
  },
  inverse: restoreInverse,
});

// ---------------------------------------------------------------- Needs a look / rules

export const confirm = defineAction({
  name: "flows.confirm",
  description: "Confirm transactions are right as they are, removing them from Needs a look (or put them back).",
  input: z.object({ transactionIds: z.array(idSchema).min(1).max(100), confirmed: z.boolean().default(true) }),
  needs: ["transactions", "overrides"],
  examples: [{ transactionIds: ["tx_poker_in", "tx_paycheck"], confirmed: true }],
  describe(data, input) {
    const txs = input.transactionIds.map((id) => requireTx(data, id));
    return {
      summary: `${input.confirmed ? "Confirm" : "Un-confirm"} ${txs.length} transaction${txs.length === 1 ? "" : "s"}`,
      changes: txs.map((t) => ({
        label: txLabel(t),
        before: findRow(data, "overrides", { transactionId: t.id })?.confirmedAt ? "Confirmed" : "Needs a look",
        after: input.confirmed ? "Confirmed" : "Needs a look",
      })),
    };
  },
  apply(data, input, ctx) {
    return input.transactionIds.map((id) => {
      requireTx(data, id);
      return overrideWith(data, id, ctx, { confirmedAt: input.confirmed ? ctx.now : null });
    });
  },
  inverse: restoreInverse,
});

export const deleteRule = defineAction({
  name: "flows.deleteRule",
  description: "Delete one of my rules (category, transfer, income, Poker or necessity rules).",
  input: z.object({ ruleId: idSchema }),
  needs: ["rules"],
  describe(data, input) {
    const r = findRow(data, "rules", { id: input.ruleId });
    if (!r) throw new ActionError(`No rule ${input.ruleId}`);
    const what = [r.setCategory && `category ${r.setCategory}`, r.setBucket && `count as ${r.setBucket}`, r.setNecessity && r.setNecessity]
      .filter(Boolean)
      .join(", ");
    return { summary: `Delete the rule for ${r.matchValue}`, changes: [{ label: "Rule", before: `${r.matchValue}: ${what}`, after: null }] };
  },
  apply(data, input) {
    if (!findRow(data, "rules", { id: input.ruleId })) throw new ActionError(`No rule ${input.ruleId}`);
    return [{ op: "delete", table: "rules", key: { id: input.ruleId } }];
  },
  inverse: restoreInverse,
});

