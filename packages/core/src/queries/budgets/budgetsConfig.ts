/**
 * The budget plan as it stands (for edit forms): each budget with its
 * period, current amount and current parts (with what each covers), every
 * trip, and the categories, merchants and tags a part can target.
 */
import { z } from "zod";
import { defineQuery } from "../../registry.ts";
import { isoDateSchema } from "../../schemas.ts";
import { LEDGER_NEEDS, buildLedger } from "../../flows/ledger.ts";
import { BUDGET_NEEDS, amountForPeriod, partsForPeriod } from "../../budgets/budget.ts";
import { currentPeriod } from "../../budgets/periods.ts";
import type { BudgetPartTargetKind } from "../../types.ts";

export interface BudgetConfigPart {
  partId: string;
  name: string;
  expectedCents: number;
  position: number;
  targets: { kind: BudgetPartTargetKind; value: string }[];
}

export const config = defineQuery({
  name: "budgets.config",
  description:
    "The budget plan for editing: each budget's period type, dates, current amount and current parts with the categories, merchants or tag each covers; every trip; and the categories, merchants and tags available to target.",
  params: z.object({ date: isoDateSchema.optional() }),
  needs: [...LEDGER_NEEDS, ...BUDGET_NEEDS],
  examples: [{}],
  run(data, p, today) {
    const date = p.date ?? today;
    const budgets = data.budgets
      .filter((b) => b.archivedAt === null)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1))
      .map((b) => {
        const period = currentPeriod(b, date);
        const parts: BudgetConfigPart[] = partsForPeriod(data.budgetParts, b.id, period).map((part) => ({
          partId: part.id,
          name: part.name,
          expectedCents: part.expectedCents,
          position: part.position,
          targets: data.budgetPartTargets.filter((t) => t.partId === part.id).map((t) => ({ kind: t.targetKind, value: t.targetValue })),
        }));
        return {
          budgetId: b.id,
          name: b.name,
          periodKind: b.periodKind,
          anchorDate: b.anchorDate,
          customEndDate: b.customEndDate,
          period,
          amountCents: amountForPeriod(data.budgetAmounts, b.id, period),
          parts,
        };
      });
    const trips = [...data.trips]
      .sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : a.id < b.id ? -1 : 1))
      .map((t) => ({ ...t, tagName: data.tags.find((x) => x.id === t.tagId)?.name ?? null }));

    // Choices: what spending has used, most-used first, then by name.
    const ledger = buildLedger(data);
    const spending = ledger.entries.filter((e) => e.bucket === "spending");
    const rank = <T extends { label: string }>(m: Map<string, T & { count: number }>) =>
      [...m.values()].sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : 1)).map(({ count: _c, ...rest }) => rest);
    const cats = new Map<string, { value: string; label: string; count: number }>();
    const merchants = new Map<string, { value: string; label: string; count: number }>();
    for (const e of spending) {
      for (const c of new Set([e.categoryPrimary, e.category])) {
        const cur = cats.get(c) ?? { value: c, label: c, count: 0 };
        cur.count += 1;
        cats.set(c, cur);
      }
      const m = merchants.get(e.merchantKey) ?? { value: e.merchantKey, label: e.merchantName, count: 0 };
      m.count += 1;
      merchants.set(e.merchantKey, m);
    }
    const tags = [...data.tags].sort((a, b) => (a.name < b.name ? -1 : 1)).map((t) => ({ value: t.id, label: t.name }));
    return { value: { budgets, trips, choices: { categories: rank(cats), merchants: rank(merchants), tags } }, figures: {} };
  },
});
