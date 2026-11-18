/** Spending heatmap (§8, design.md §3): days × weeks, plus a day-of-week summary. Every cell drills down. */
import { monthEnd, monthStart, type Spending } from "@ft/core";
import { dayLabel } from "../../data/dates.ts";
import { EmptyState } from "../../ui/components.tsx";
import { money, moneyShort } from "../transactions/format.ts";
import { useFigures } from "./drill.ts";
import { MiniBars } from "./MiniBars.tsx";
import { color } from "../../ui/tokens.ts";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAYS_LONG = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];

/** 0 → no tint, max → full tint (5 steps, so it's readable and never colour alone: amounts are in the tooltip/label). */
export function heatLevel(cents: number, max: number): number {
  if (cents <= 0 || max <= 0) return 0;
  return Math.max(1, Math.ceil((cents / max) * 4));
}

export function CalendarPanel({ month }: { month: string }) {
  const q = useFigures<Spending.Heatmap>("spending.heatmap", { from: monthStart(month), to: monthEnd(month) });
  const v = q.value;
  if (!v) return <p className="tx-muted">Loading…</p>;
  if (v.maxDayCents === 0) return <EmptyState icon="spending" title="No spending this month" description="Days light up as purchases clear." />;
  const lead = v.days[0]?.dayOfWeek ?? 0;
  return (
    <div className="sp-panel sp-calendar">
      <div className="sp-heat" role="grid" aria-label="Spending by day">
        {DAYS.map((d) => (
          <span key={d} className="sp-heat__dow" role="columnheader">
            {d}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead${i}`} />
        ))}
        {v.days.map((d) => {
          const level = heatLevel(d.cents, v.maxDayCents);
          const label = `${dayLabel(d.date)}: ${money(d.cents)}${d.count ? `, ${d.count} ${d.count === 1 ? "purchase" : "purchases"}` : ""}`;
          const onClick = q.drill(`day.${d.date}`);
          return onClick ? (
            <button key={d.date} type="button" role="gridcell" className={`sp-heat__cell lvl-${level}`} aria-label={label} title={label} onClick={onClick}>
              <span className="sp-heat__day">{Number(d.date.slice(8))}</span>
              <span className="sp-heat__amt">{moneyShort(d.cents).replace(/\.\d\d$/, "")}</span>
            </button>
          ) : (
            <span key={d.date} role="gridcell" className="sp-heat__cell lvl-0" title={label}>
              <span className="sp-heat__day">{Number(d.date.slice(8))}</span>
            </span>
          );
        })}
      </div>
      <div className="sp-dow">
        <p className="tx-muted">Average per day of the week</p>
        <MiniBars
          ariaLabel="Spending by day of the week"
          max={Math.max(...v.byDayOfWeek.map((d) => d.averageCents))}
          color={color["orange-600"]}
          height={64}
          bars={v.byDayOfWeek.map((d) => ({
            key: String(d.dayOfWeek),
            short: DAYS[d.dayOfWeek]!,
            top: moneyShort(d.averageCents).replace(/\.\d\d$/, ""),
            label: `${DAYS_LONG[d.dayOfWeek]}: ${money(d.cents)} over ${d.days} days (${money(d.averageCents)} a day)`,
            value: d.averageCents,
            onClick: q.drill(`dow.${d.dayOfWeek}`),
          }))}
        />
      </div>
    </div>
  );
}
