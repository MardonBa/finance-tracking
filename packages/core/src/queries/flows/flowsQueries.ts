import { z } from "zod";
import { defineQuery } from "../../registry.ts";
import type { Figure } from "../../registry.ts";
import { addDays } from "../../dates.ts";
import { BUCKETS, type Bucket } from "../../types.ts";
import { idSchema, isoDateSchema } from "../../schemas.ts";
import { LEDGER_NEEDS, buildLedger, countable } from "../../flows/ledger.ts";
import { figure, inPeriod, measures, groupBy } from "../../flows/figures.ts";
import { needsALook } from "../../flows/needsALook.ts";
import { pokerSummary } from "../../flows/poker.ts";
import { netWorthEquation, reconcileAccount } from "../../flows/reconcile.ts";
import { suggestRefundLinks } from "../../flows/refunds.ts";
import { rowFor, transferLabel } from "../../flows/rows.ts";
import { rangeSchema } from "../../flows/params.ts";

const OCT = { from: "2026-10-01", to: "2026-10-31" };

/** Every transaction in exactly one bucket, with each bucket's total. */
export const buckets = defineQuery({
  name: "flows.buckets",
  description:
    "Totals per bucket (spending, income, transfer, Poker) for a date range, and which bucket each transaction landed in and why.",
  params: rangeSchema,
  needs: LEDGER_NEEDS,
  examples: [OCT],
  run(data, p) {
    const ledger = buildLedger(data);
    const entries = inPeriod(ledger.entries, p.from, p.to);
    const figures: Record<string, Figure> = {
      spending: figure(entries, measures.spend, `Spending · ${p.from} – ${p.to}`),
      income: figure(entries.filter((e) => e.bucket === "income"), measures.income, `Income · ${p.from} – ${p.to}`),
      transferIn: figure(entries.filter((e) => e.bucket === "transfer"), measures.inflow, `Transfers in · ${p.from} – ${p.to}`),
      transferOut: figure(entries.filter((e) => e.bucket === "transfer"), measures.outflow, `Transfers out · ${p.from} – ${p.to}`),
      pokerNet: figure(entries.filter((e) => e.bucket === "poker"), measures.amount, `Poker net · ${p.from} – ${p.to}`),
    };
    const byTx = groupBy(entries, (e) => e.transactionId);
    const transactions = [...byTx.entries()].map(([id, es]) => ({
      transactionId: id,
      bucket: es[0]!.bucket as Bucket,
      reason: es[0]!.bucketReason,
    }));
    const counts = Object.fromEntries(BUCKETS.map((b) => [b, transactions.filter((t) => t.bucket === b).length])) as Record<Bucket, number>;
    return {
      value: {
        spendingCents: figures.spending!.cents,
        incomeCents: figures.income!.cents,
        transferInCents: figures.transferIn!.cents,
        transferOutCents: figures.transferOut!.cents,
        pokerNetCents: figures.pokerNet!.cents,
        counts,
        transactions,
      },
      figures,
    };
  },
});

export const needsALookQuery = defineQuery({
  name: "flows.needsALook",
  description:
    "The short list of transactions the app is unsure about: unmatched transfers, uncertain transfer matches, uncategorised, possible duplicates, large unusual amounts.",
  params: z.object({ from: isoDateSchema.optional(), to: isoDateSchema.optional() }),
  needs: LEDGER_NEEDS,
  examples: [{}, OCT],
  run(data, p, today) {
    const ledger = buildLedger(data);
    // TODO(revisit): Needs a look covers the last 90 days by default.
    const from = p.from ?? addDays(today, -90);
    const to = p.to ?? today;
    const items = needsALook(ledger, { from, to });
    const figures: Record<string, Figure> = {};
    for (const it of items) {
      figures[it.id] = figure(
        it.transactionIds.flatMap((id) => ledger.byTransaction.get(id) ?? []),
        measures.amount,
        it.reason,
      );
    }
    return {
      value: { from, to, count: items.length, items: items.map((it) => ({ ...it, rows: it.transactionIds.map((id) => rowFor(ledger, id)!) })) },
      figures,
    };
  },
});

export const transfers = defineQuery({
  name: "flows.transfers",
  description: 'Matched transfers shown as one item each ("Transfer: Checking → HYSA"), plus transfers with no matching other half.',
  params: rangeSchema,
  needs: LEDGER_NEEDS,
  examples: [OCT],
  run(data, p) {
    const ledger = buildLedger(data);
    const figures: Record<string, Figure> = {};
    const pairs = ledger.transferLinks
      .map((l) => {
        const out = ledger.byTransaction.get(l.outTransactionId)?.[0];
        const inn = ledger.byTransaction.get(l.inTransactionId)?.[0];
        if (!out || !inn) return null;
        if (!(countable(out) && out.countDate >= p.from && out.countDate <= p.to) && !(countable(inn) && inn.countDate >= p.from && inn.countDate <= p.to)) return null;
        figures[`pair.${l.id}`] = figure([out], measures.outflow, transferLabel(ledger, out) ?? "Transfer");
        return {
          linkId: l.id,
          source: l.source,
          needsReview: l.needsReview,
          label: transferLabel(ledger, out)!,
          amountCents: -out.amountCents,
          outTransactionId: l.outTransactionId,
          inTransactionId: l.inTransactionId,
          date: out.date,
          note: out.note ?? inn.note,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    const unmatched = inPeriod(ledger.entries, p.from, p.to)
      .filter((e) => e.bucket === "transfer" && e.transferLinkId === null)
      .map((e) => {
        figures[`unmatched.${e.key}`] = figure([e], measures.amount, `Transfer · ${e.merchantName}`);
        return { transactionId: e.transactionId, amountCents: e.amountCents, date: e.date, reason: e.bucketReason, confirmed: e.confirmed };
      });
    return { value: { pairs, unmatched }, figures };
  },
});

export const refundSuggestions = defineQuery({
  name: "flows.refundSuggestions",
  description: "Suggested purchase for each unlinked refund: same merchant, refund no more than the purchase, within 90 days.",
  params: z.object({}),
  needs: LEDGER_NEEDS,
  examples: [{}],
  run(data) {
    const ledger = buildLedger(data);
    const list = suggestRefundLinks(ledger, data.refundLinks);
    const figures: Record<string, Figure> = {};
    for (const s of list) {
      figures[`refund.${s.refundTransactionId}`] = figure(ledger.byTransaction.get(s.refundTransactionId) ?? [], measures.amount, `Refund from ${s.merchantName}`);
    }
    return { value: list, figures };
  },
});

export const poker = defineQuery({
  name: "flows.poker",
  description: "Poker summary for a period: money in, money out and the net result that counts as income.",
  params: rangeSchema,
  needs: LEDGER_NEEDS,
  examples: [OCT],
  run(data, p) {
    const r = pokerSummary(buildLedger(data), p.from, p.to);
    return { value: r.value, figures: { ...r.figures } };
  },
});

export const reconciliation = defineQuery({
  name: "flows.reconciliation",
  description:
    "Per account: start balance + money in − money out vs the end balance from snapshots, with any difference shown as unexplained.",
  params: rangeSchema.and(z.object({ accountId: idSchema.optional() })),
  needs: [...LEDGER_NEEDS, "balanceSnapshots"],
  examples: [OCT, { ...OCT, accountId: "acc_checking" }],
  run(data, p) {
    const ledger = buildLedger(data);
    const ids = p.accountId ? [p.accountId] : [...ledger.accounts.keys()].sort();
    const figures: Record<string, Figure> = {};
    const accounts = ids.map((id) => {
      const r = reconcileAccount(ledger, data.balanceSnapshots, id, p.from, p.to);
      figures[`${id}.in`] = r.figures.in;
      figures[`${id}.out`] = r.figures.out;
      return r.value;
    });
    return { value: { accounts, unexplainedCount: accounts.filter((a) => a.status === "unexplained").length }, figures };
  },
});

export const netWorthEquationQuery = defineQuery({
  name: "flows.netWorthEquation",
  description:
    "Income − spending + Poker ± transfers to unlinked accounts + investment gains vs the change in net worth, with any leftover shown.",
  params: rangeSchema,
  needs: [...LEDGER_NEEDS, "balanceSnapshots"],
  examples: [OCT],
  run(data, p) {
    return netWorthEquation(buildLedger(data), data.balanceSnapshots, p.from, p.to);
  },
});

export const incomeLines = defineQuery({
  name: "flows.income",
  description: "Income for a period by source (paychecks, interest, dividends, …) plus the Poker net as one line.",
  params: rangeSchema,
  needs: LEDGER_NEEDS,
  examples: [OCT],
  run(data, p) {
    const ledger = buildLedger(data);
    const entries = inPeriod(ledger.entries, p.from, p.to);
    const figures: Record<string, Figure> = {
      total: figure(entries, measures.incomeWithPoker, `Income · ${p.from} – ${p.to}`),
    };
    const lines = [...groupBy(entries.filter((e) => e.bucket === "income"), (e) => e.merchantKey).entries()].map(([key, es]) => {
      const f = figure(es, measures.income, `Income from ${es[0]!.merchantName}`);
      figures[`source.${key}`] = f;
      return { key, label: es[0]!.merchantName, category: es[0]!.category, cents: f.cents };
    });
    lines.sort((a, b) => b.cents - a.cents || (a.key < b.key ? -1 : 1));
    const pokerEntries = entries.filter((e) => e.bucket === "poker");
    if (pokerEntries.length > 0) {
      const f = figure(pokerEntries, measures.amount, `Poker net · ${p.from} – ${p.to}`);
      figures["source.poker"] = f;
      lines.push({ key: "poker", label: "Poker", category: "POKER", cents: f.cents });
    }
    return { value: { totalCents: figures.total!.cents, lines }, figures };
  },
});
