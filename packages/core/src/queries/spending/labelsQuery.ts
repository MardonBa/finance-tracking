import { defineQuery, type Figure } from "../../registry.ts";
import { categoryLabel } from "../../flows/categories.ts";
import { figure, groupBy, inPeriod, measures } from "../../flows/figures.ts";
import { LEDGER_NEEDS, buildLedger } from "../../flows/ledger.ts";
import { rangeSchema } from "../../flows/params.ts";
import type { Necessity } from "../../types.ts";

/**
 * What can be labelled necessary / not necessary (§8), with its spending in
 * the period and its current label (null = "not set"; there are no defaults).
 * Broad categories and every merchant with spending, biggest first.
 */
export const necessityLabels = defineQuery({
  name: "spending.necessityLabels",
  description:
    "Categories and merchants with their spending for a period and their necessary / not necessary label (null when not set; no defaults).",
  params: rangeSchema,
  needs: LEDGER_NEEDS,
  examples: [{ from: "2026-10-01", to: "2026-10-31" }],
  run(data, p) {
    const ledger = buildLedger(data);
    const labels = new Map(data.necessaryLabels.map((l) => [`${l.targetKind}:${l.targetValue}`, l.necessity]));
    const spending = inPeriod(ledger.entries, p.from, p.to).filter((e) => e.bucket === "spending");
    const figures: Record<string, Figure> = {};
    const row = (kind: "category" | "merchant", key: string, label: string, f: Figure) => {
      figures[`${kind}.${key}`] = f;
      const necessity: Necessity | null = labels.get(`${kind}:${key}`) ?? null;
      return { targetKind: kind, targetValue: key, label, spendCents: f.cents, necessity };
    };
    const byCents = (a: { spendCents: number; targetValue: string }, b: { spendCents: number; targetValue: string }) =>
      b.spendCents - a.spendCents || (a.targetValue < b.targetValue ? -1 : 1);
    const categories = [...groupBy(spending, (e) => e.categoryPrimary).entries()]
      .map(([cat, es]) => row("category", cat, categoryLabel(cat), figure(es, measures.spend, `${categoryLabel(cat)} · ${p.from} – ${p.to}`)))
      .sort(byCents);
    const merchants = [...groupBy(spending, (e) => e.merchantKey).entries()]
      .map(([key, es]) => {
        const name = ledger.merchantNames.get(key) ?? key;
        return row("merchant", key, name, figure(es, measures.spend, `${name} · ${p.from} – ${p.to}`));
      })
      .sort(byCents);
    return { value: { categories, merchants }, figures };
  },
});
