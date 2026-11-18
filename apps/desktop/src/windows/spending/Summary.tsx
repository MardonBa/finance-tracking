/**
 * Monthly summary (§8): income, spending, saved and savings rate, each vs the
 * previous month and vs usual (which months it used is always stated).
 */
import type { ReactNode } from "react";
import type { Spending } from "@ft/core";
import { monthShort } from "../../data/dates.ts";
import { StatNumber } from "../../ui/components.tsx";
import { money, pct, points, signed } from "../transactions/format.ts";
import { useFigures } from "./drill.ts";

type Key = "income" | "spending" | "saved";

function Versus({ label, cents, diff, onClick }: { label: string; cents: number | null; diff: number | null; onClick?: () => void }) {
  if (cents === null) return <span>{label}: no data</span>;
  const value = onClick ? (
    <button type="button" className="sp-inline-drill" onClick={onClick} aria-label={`${label}: ${money(cents)}. Show transactions`}>
      {money(cents)}
    </button>
  ) : (
    money(cents)
  );
  return (
    <span>
      {label} {value} ({diff === null ? "—" : signed(diff)})
    </span>
  );
}

export function Summary({ month, usualMonths }: { month: string; usualMonths: 1 | 2 | 3 }) {
  const params = { month, usualMonths };
  const s = useFigures<Spending.MonthlySummary>("spending.monthlySummary", params);
  const v = s.value;
  if (!v) return <div className="sp-summary sp-summary--loading" aria-busy="true" />;
  const prevLabel = monthShort(v.previous.month);
  const stat = (key: Key, label: string, cents: number): ReactNode => (
    <StatNumber
      label={label}
      value={money(cents)}
      size="md"
      onDrillDown={s.drill(key)}
      detail={
        <span className="sp-versus">
          <Versus label={`vs ${prevLabel}`} cents={v.vsPrevious[key].cents} diff={v.vsPrevious[key].diffCents} onClick={s.drill(`previous.${key}`)} />
          <Versus label="vs usual" cents={v.vsUsual[key].cents} diff={v.vsUsual[key].diffCents} />
        </span>
      }
    />
  );
  return (
    <div className="sp-summary" data-testid="monthly-summary">
      {stat("income", v.pokerNetCents !== 0 ? `Income (incl. Poker ${signed(v.pokerNetCents)})` : "Income", v.incomeCents)}
      {stat("spending", "Spending", v.spendingCents)}
      {stat("saved", v.savedCents < 0 ? "Overspent" : "Saved", v.savedCents)}
      <StatNumber
        label="Savings rate"
        value={pct(v.savingsRate)}
        size="md"
        detail={
          <span className="sp-versus">
            <span>
              vs {prevLabel} {pct(v.previous.savingsRate)} ({points(v.vsPrevious.savingsRatePoints)})
            </span>
            <span>
              vs usual {pct(v.usual.savingsRate)} ({points(v.vsUsual.savingsRatePoints)})
            </span>
          </span>
        }
      />
      <p className="sp-usual-note" data-testid="usual-basis">
        Usual = {v.usual.basis.label} ({v.usual.basis.chosen === 1 ? "1 month" : `${v.usual.basis.chosen} months`} chosen)
      </p>
    </div>
  );
}
