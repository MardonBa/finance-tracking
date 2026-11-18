import { z } from "zod";
import { ActionError, defineAction, findRow, type Mutation } from "../../registry.ts";
import { NECESSITY, type Merchant, type MerchantAlias, type Split, type Tag } from "../../types.ts";
import { Money } from "../../money.ts";
import { centsSchema, idSchema } from "../../schemas.ts";
import { LEDGER_NEEDS, buildLedger } from "../../flows/ledger.ts";
import { merchantResolver, rawAliasKey } from "../../flows/merchants.ts";
import {
  catLabel,
  overrideWith,
  requireTx,
  restoreInverse,
  ruleWith,
  txLabel,
} from "../../flows/actionHelpers.ts";

const categoryOf = (data: Parameters<typeof buildLedger>[0], id: string) => buildLedger(data).byTransaction.get(id)?.[0]?.category ?? null;

// ---------------------------------------------------------------- recategorise

export const recategorise = defineAction({
  name: "transactions.recategorise",
  description:
    "Change one transaction's category (or clear the fix), optionally always for this merchant (a rule that also applies to its past transactions).",
  input: z.object({
    transactionId: idSchema,
    category: z.string().min(1).max(100).nullable(),
    alwaysForMerchant: z.boolean().default(false),
  }),
  needs: LEDGER_NEEDS,
  examples: [
    { transactionId: "tx_card_purchase_dining", category: "FOOD_AND_DRINK_RESTAURANT", alwaysForMerchant: false },
    { transactionId: "tx_card_purchase_amazon", category: "GENERAL_MERCHANDISE_ELECTRONICS", alwaysForMerchant: true },
  ],
  describe(data, input, ctx) {
    const tx = requireTx(data, input.transactionId);
    const changes = [{ label: "Category", before: catLabel(categoryOf(data, tx.id)), after: catLabel(input.category) }];
    if (input.alwaysForMerchant && input.category) {
      const r = ruleWith(data, tx, { kind: "merchant", thisAccountOnly: false }, ctx, { setCategory: input.category });
      changes.push({ label: "Rule", before: null, after: `Always use ${catLabel(input.category)} for ${r.description}` });
    }
    return { summary: `Recategorise ${txLabel(tx)}`, changes };
  },
  apply(data, input, ctx) {
    const tx = requireTx(data, input.transactionId);
    const muts: Mutation[] = [overrideWith(data, tx.id, ctx, { category: input.category })];
    // TODO(revisit): rules apply to past transactions too (no "from date" on rules yet).
    if (input.alwaysForMerchant && input.category) {
      muts.push(ruleWith(data, tx, { kind: "merchant", thisAccountOnly: false }, ctx, { setCategory: input.category }).mutation);
    }
    return muts;
  },
  inverse: restoreInverse,
});

// ---------------------------------------------------------------- notes, tags, necessity

export const setNote = defineAction({
  name: "transactions.setNote",
  description: "Add, edit or remove the note on any transaction (purchases, income, transfers, investments, card payments, Poker, cash).",
  input: z.object({ transactionId: idSchema, note: z.string().max(2000).nullable() }),
  // The ledger finds the other half of a matched transfer (one note per pair, §7).
  needs: LEDGER_NEEDS,
  examples: [
    { transactionId: "tx_transfer_out_hysa", note: "Monthly savings" },
    { transactionId: "tx_poker_in", note: null },
  ],
  describe(data, input) {
    const tx = requireTx(data, input.transactionId);
    const pair = notePair(data, tx.id);
    const before = pair.map((id) => findRow(data, "overrides", { transactionId: id })?.note ?? null).find((n) => n !== null) ?? null;
    const note = input.note && input.note.trim().length > 0 ? input.note : null;
    const what = pair.length > 1 ? `${txLabel(tx)} (one note for the matched transfer)` : txLabel(tx);
    return { summary: `${note ? "Set" : "Remove"} the note on ${what}`, changes: [{ label: "Note", before, after: note }] };
  },
  apply(data, input, ctx) {
    const tx = requireTx(data, input.transactionId);
    const note = input.note && input.note.trim().length > 0 ? input.note : null;
    // A matched transfer keeps one note, on its money-out half; the other half's is cleared.
    const [holder, ...others] = notePair(data, tx.id);
    const muts: Mutation[] = [overrideWith(data, holder!, ctx, { note })];
    for (const id of others) if (findRow(data, "overrides", { transactionId: id })?.note) muts.push(overrideWith(data, id, ctx, { note: null }));
    return muts;
  },
  inverse: restoreInverse,
});

/** [the transaction that holds the note, …the other half of its matched transfer]. */
function notePair(data: Parameters<typeof buildLedger>[0], id: string): string[] {
  const other = buildLedger(data).byTransaction.get(id)?.[0]?.transferCounterpartId ?? null;
  if (!other) return [id];
  const self = findRow(data, "transactions", { id })!;
  return self.amountCents < 0 ? [id, other] : [other, id];
}

export const setTags = defineAction({
  name: "transactions.setTags",
  description: 'Set the hand-applied tags on a transaction (e.g. "Lisbon trip"); new tag names are created.',
  input: z.object({ transactionId: idSchema, tags: z.array(z.string().trim().min(1).max(60)).max(20) }),
  needs: ["transactions", "tags", "transactionTags"],
  examples: [
    { transactionId: "tx_card_purchase_dining", tags: ["Lisbon trip"] },
    { transactionId: "tx_card_purchase_dining", tags: [] },
  ],
  describe(data, input) {
    const tx = requireTx(data, input.transactionId);
    const names = new Map(data.tags.map((t) => [t.id, t.name]));
    const before = data.transactionTags.filter((t) => t.transactionId === tx.id).map((t) => names.get(t.tagId) ?? t.tagId);
    const after = [...new Set(input.tags)];
    return {
      summary: `Tag ${txLabel(tx)}`,
      changes: [{ label: "Tags", before: before.length ? before.sort().join(", ") : null, after: after.length ? after.sort().join(", ") : null }],
    };
  },
  apply(data, input, ctx) {
    const tx = requireTx(data, input.transactionId);
    const muts: Mutation[] = [];
    const byName = new Map(data.tags.map((t) => [t.name.toLowerCase(), t]));
    const wanted = new Set<string>();
    for (const name of new Set(input.tags)) {
      let tag = byName.get(name.toLowerCase());
      if (!tag) {
        tag = { id: ctx.newId(), name, createdAt: ctx.now } satisfies Tag;
        byName.set(name.toLowerCase(), tag);
        muts.push({ op: "upsert", table: "tags", row: tag });
      }
      wanted.add(tag.id);
    }
    const current = data.transactionTags.filter((t) => t.transactionId === tx.id);
    for (const t of current) if (!wanted.has(t.tagId)) muts.push({ op: "delete", table: "transactionTags", key: { transactionId: tx.id, tagId: t.tagId } });
    for (const id of [...wanted].sort()) {
      if (!current.some((t) => t.tagId === id)) muts.push({ op: "upsert", table: "transactionTags", row: { transactionId: tx.id, tagId: id } });
    }
    return muts;
  },
  inverse: restoreInverse,
});

export const setNecessity = defineAction({
  name: "transactions.setNecessity",
  description: "Mark one transaction as necessary or not necessary (overrides its merchant and category labels), or clear it.",
  input: z.object({ transactionId: idSchema, necessity: z.enum(NECESSITY).nullable() }),
  needs: LEDGER_NEEDS,
  examples: [{ transactionId: "tx_card_purchase_dining", necessity: "not_necessary" }],
  describe(data, input) {
    const tx = requireTx(data, input.transactionId);
    const before = buildLedger(data).byTransaction.get(tx.id)?.[0]?.necessity ?? null;
    const label = (n: string | null) => (n === null ? "Not set" : n === "necessary" ? "Necessary" : "Not necessary");
    return { summary: `Label ${txLabel(tx)}`, changes: [{ label: "Necessary?", before: label(before), after: input.necessity === null ? "From merchant / category" : label(input.necessity) }] };
  },
  apply(data, input, ctx) {
    const tx = requireTx(data, input.transactionId);
    return [overrideWith(data, tx.id, ctx, { necessity: input.necessity })];
  },
  inverse: restoreInverse,
});

// ---------------------------------------------------------------- splits

const partSchema = z.object({
  amountCents: centsSchema,
  category: z.string().min(1).max(100).nullable().default(null),
  necessity: z.enum(NECESSITY).nullable().default(null),
  note: z.string().max(2000).nullable().default(null),
});

export const split = defineAction({
  name: "transactions.split",
  description: "Split one transaction into parts, each with its own category and amount; the parts must add up to the original amount.",
  input: z.object({ transactionId: idSchema, parts: z.array(partSchema).min(2).max(20) }),
  needs: ["transactions", "splits"],
  examples: [
    {
      transactionId: "tx_card_purchase_amazon",
      parts: [
        { amountCents: -9999, category: "GENERAL_MERCHANDISE_ELECTRONICS", necessity: null, note: null },
        { amountCents: -3000, category: "PERSONAL_CARE", necessity: "necessary", note: "Shampoo" },
      ],
    },
    {
      transactionId: "tx_split_costco",
      parts: [
        { amountCents: -5000, category: "FOOD_AND_DRINK_GROCERIES", necessity: null, note: null },
        { amountCents: -10000, category: null, necessity: null, note: null },
      ],
    },
  ],
  describe(data, input) {
    const tx = requireTx(data, input.transactionId);
    const fmt = (parts: { amountCents: number; category: string | null }[]) =>
      parts.length === 0 ? null : parts.map((p) => `${Money.format(p.amountCents)} ${catLabel(p.category) ?? "(same category)"}`).join(" + ");
    const before = data.splits.filter((s) => s.transactionId === tx.id).sort((a, b) => a.position - b.position);
    return { summary: `Split ${txLabel(tx)} into ${input.parts.length} parts`, changes: [{ label: "Parts", before: fmt(before), after: fmt(input.parts) }] };
  },
  apply(data, input, ctx) {
    const tx = requireTx(data, input.transactionId);
    const sum = Money.sum(input.parts.map((p) => p.amountCents));
    if (sum !== tx.amountCents) {
      throw new ActionError(`The parts add up to ${Money.format(sum)}, not the original ${Money.format(tx.amountCents)}`);
    }
    if (input.parts.some((p) => p.amountCents === 0)) throw new ActionError("A part can't be $0.00");
    const muts: Mutation[] = data.splits
      .filter((s) => s.transactionId === tx.id)
      .map((s): Mutation => ({ op: "delete", table: "splits", key: { id: s.id } }));
    input.parts.forEach((p, i) => {
      const row: Split = { id: ctx.newId(), transactionId: tx.id, amountCents: p.amountCents, category: p.category, necessity: p.necessity, note: p.note, position: i };
      muts.push({ op: "upsert", table: "splits", row });
    });
    return muts;
  },
  inverse: restoreInverse,
});

export const unsplit = defineAction({
  name: "transactions.unsplit",
  description: "Remove the split from a transaction so it counts as one again.",
  input: z.object({ transactionId: idSchema }),
  needs: ["transactions", "splits"],
  examples: [{ transactionId: "tx_split_costco" }],
  describe(data, input) {
    const tx = requireTx(data, input.transactionId);
    const n = data.splits.filter((s) => s.transactionId === tx.id).length;
    return { summary: `Unsplit ${txLabel(tx)}`, changes: [{ label: "Parts", before: `${n} parts`, after: "One transaction" }] };
  },
  apply(data, input) {
    const tx = requireTx(data, input.transactionId);
    const parts = data.splits.filter((s) => s.transactionId === tx.id);
    if (parts.length === 0) throw new ActionError(`${txLabel(tx)} isn't split`);
    return parts.map((s): Mutation => ({ op: "delete", table: "splits", key: { id: s.id } }));
  },
  inverse: restoreInverse,
});

// ---------------------------------------------------------------- merchants

/** Tables whose rows name a merchant key, re-pointed when merchants merge. */
const MERCHANT_REF_NEEDS = ["rules", "necessaryLabels", "cuttingBack", "budgetPartTargets"] as const;

export const mergeMerchants = defineAction({
  name: "transactions.mergeMerchants",
  description: 'Group several merchant names as one merchant (e.g. "AMAZON MKTP US*2K4" and "Amazon.com"), with a display name.',
  input: z.object({ merchantKeys: z.array(z.string().min(1)).min(2).max(50), name: z.string().trim().min(1).max(100) }),
  needs: [...LEDGER_NEEDS, ...MERCHANT_REF_NEEDS],
  examples: [{ merchantKeys: ["auto:AMAZON", "auto:COSTCO"], name: "Shopping" }],
  describe(data, input) {
    const ledger = buildLedger(data);
    const names = input.merchantKeys.map((k) => ledger.merchantNames.get(k) ?? k.replace(/^auto:/, ""));
    return { summary: `Merge ${names.join(", ")} into "${input.name}"`, changes: [{ label: "Merchants", before: names.join(", "), after: input.name }] };
  },
  apply(data, input, ctx) {
    const keys = [...new Set(input.merchantKeys)];
    if (keys.length < 2) throw new ActionError("Pick at least two different merchants to merge");
    const merchantIds = new Set(data.merchants.map((m) => m.id));
    for (const k of keys) if (!k.startsWith("auto:") && !merchantIds.has(k)) throw new ActionError(`No merchant ${k}`);
    const muts: Mutation[] = [];
    const existing = keys.find((k) => merchantIds.has(k));
    const target: Merchant = existing
      ? { ...findRow(data, "merchants", { id: existing })!, name: input.name }
      : { id: ctx.newId(), name: input.name, createdAt: ctx.now };
    muts.push({ op: "upsert", table: "merchants", row: target });
    for (const k of keys) {
      if (k === target.id) continue;
      if (k.startsWith("auto:")) {
        const alias: MerchantAlias = { id: ctx.newId(), merchantId: target.id, matchKey: k.slice(5), source: "manual" };
        muts.push({ op: "upsert", table: "merchantAliases", row: alias });
      } else {
        for (const a of data.merchantAliases.filter((x) => x.merchantId === k)) {
          muts.push({ op: "upsert", table: "merchantAliases", row: { ...a, merchantId: target.id } });
        }
        muts.push({ op: "delete", table: "merchants", key: { id: k } });
      }
    }
    // Rules, labels, cutting-back items and budget parts follow the merge.
    const old = new Set(keys.filter((k) => k !== target.id));
    for (const r of data.rules) if (r.matchKind === "merchant" && old.has(r.matchValue)) muts.push({ op: "upsert", table: "rules", row: { ...r, matchValue: target.id } });
    for (const l of data.necessaryLabels) if (l.targetKind === "merchant" && old.has(l.targetValue)) muts.push({ op: "upsert", table: "necessaryLabels", row: { ...l, targetValue: target.id } });
    for (const c of data.cuttingBack) if (c.targetKind === "merchant" && old.has(c.targetValue)) muts.push({ op: "upsert", table: "cuttingBack", row: { ...c, targetValue: target.id } });
    for (const t of data.budgetPartTargets) {
      if (t.targetKind !== "merchant" || !old.has(t.targetValue)) continue;
      muts.push({ op: "delete", table: "budgetPartTargets", key: { partId: t.partId, targetKind: t.targetKind, targetValue: t.targetValue } });
      muts.push({ op: "upsert", table: "budgetPartTargets", row: { ...t, targetValue: target.id } });
    }
    return muts;
  },
  inverse: restoreInverse,
});

export const separateMerchant = defineAction({
  name: "transactions.separateMerchant",
  description:
    "Take the transactions with this exact name out of their merchant group and make them their own merchant (when automatic grouping was wrong).",
  input: z.object({ transactionId: idSchema, name: z.string().trim().min(1).max(100) }),
  needs: ["transactions", "merchants", "merchantAliases"],
  examples: [{ transactionId: "tx_refund_amazon", name: "Amazon returns" }],
  describe(data, input) {
    const tx = requireTx(data, input.transactionId);
    const current = merchantResolver(data.merchants, data.merchantAliases).resolve(tx);
    return {
      summary: `Separate "${tx.rawDescription}" from ${current.name}`,
      changes: [{ label: "Merchant", before: current.name, after: input.name }],
    };
  },
  apply(data, input, ctx) {
    const tx = requireTx(data, input.transactionId);
    const key = rawAliasKey(tx.rawDescription);
    const merchant: Merchant = { id: ctx.newId(), name: input.name, createdAt: ctx.now };
    const muts: Mutation[] = [{ op: "upsert", table: "merchants", row: merchant }];
    const existing = data.merchantAliases.find((a) => a.matchKey === key);
    const alias: MerchantAlias = existing ? { ...existing, merchantId: merchant.id } : { id: ctx.newId(), merchantId: merchant.id, matchKey: key, source: "manual" };
    muts.push({ op: "upsert", table: "merchantAliases", row: alias });
    return muts;
  },
  inverse: restoreInverse,
});

