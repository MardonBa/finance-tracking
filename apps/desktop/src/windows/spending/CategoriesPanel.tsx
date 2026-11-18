/**
 * Per-category small multiples (§8, design.md "small multiples over rainbow
 * stacks"): one small bar chart per category on a shared scale, with this
 * month vs usual. Each bar drills down.
 */
import type { Spending } from "@ft/core";
import { monthLong, monthShort } from "../../data/dates.ts";
import { categoryColor } from "../../ui/colorMap.ts";
import { EmptyState } from "../../ui/components.tsx";
import { money, moneyShort, signed } from "../transactions/format.ts";
import { useFigures } from "./drill.ts";
import { MiniBars } from "./MiniBars.tsx";

type Value = { months: string[]; maxCents: number; basis: Spending.UsualBasis; series: Spending.CategorySeries[] };

export function CategoriesPanel({ month, usualMonths }: { month: string; usualMonths: 1 | 2 | 3 }) {
  const q = useFigures<Value>("spending.categorySeries", { endMonth: month, months: 6, usualMonths });
  const v = q.value;
  if (!v) return <p className="tx-muted">Loading…</p>;
  if (v.series.length === 0) return <EmptyState icon="spending" title="No spending in these months" description="Categories show up here once purchases clear." />;
  return (
    <div className="sp-panel">
      <p className="tx-muted">
        Last 6 months, same scale for every category. Usual = {v.basis.label}.
      </p>
      <div className="sp-multiples">
        {v.series.map((s) => {
          const last = s.months[s.months.length - 1]!;
          return (
            <div key={s.category} className="sp-multiple">
              <div className="sp-multiple__head">
                <span className="tx-cat">
                  <span className="tx-cat__dot" style={{ background: categoryColor(s.category) }} aria-hidden="true" />
                  {s.label}
                </span>
                <span className="sp-multiple__value">{moneyShort(last.cents)}</span>
              </div>
              <MiniBars
                ariaLabel={`${s.label}, monthly`}
                max={v.maxCents}
                color={categoryColor(s.category)}
                height={48}
                bars={s.months.map((p) => ({
                  key: p.month,
                  short: monthShort(p.month).slice(0, 1),
                  label: `${s.label} · ${monthLong(p.month)}: ${money(p.cents)}`,
                  value: p.cents,
                  current: p.month === month,
                  onClick: q.drill(`${s.category}.${p.month}`),
                }))}
              />
              <span className="tx-small tx-muted">
                {s.usualCents === null ? "No usual yet" : `vs usual ${money(s.usualCents)}: ${signed(s.vsUsualCents ?? 0)}`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
