/**
 * Earning vs spending (§12): income vs spending per month or year with the
 * savings rate and spending as a share of income. Totals come from
 * `spending.cashFlow` (the flows ledger); the rates from
 * `trajectory.earningVsSpending`. Clicking a bar or a number drills down.
 */
import { monthOf } from "@ft/core";
import { openDrillDown } from "../../data/drilldown.ts";
import { useQuery } from "../../data/hooks.ts";
import { Chart } from "../../ui/Chart.tsx";
import { money, pct, todayIso } from "../shared/format.ts";
import { earningOption, periodLabel } from "./charts.ts";
import type { EarningRow, Grain, MonthTotals } from "./types.ts";
import { ConnectEmptyState } from "../shared/ConnectEmptyState.tsx";

/** Opens the transactions behind one income or spending figure. */
export function drillEarning(period: string, which: "income" | "spending", cashFlowParams: unknown) {
  const what = which === "income" ? "Income" : "Spending";
  if (period.length === 7) {
    openDrillDown({ query: "spending.cashFlow", params: cashFlowParams, figureId: `${period}.${which}`, label: `${what} · ${periodLabel(period)}` });
    return;
  }
  const range = { from: `${period}-01-01`, to: `${period}-12-31` };
  if (which === "income") openDrillDown({ query: "flows.income", params: range, figureId: "total", label: `Income · ${period}` });
  else openDrillDown({ query: "spending.byCategory", params: { ...range, level: "primary" }, figureId: "total", label: `Spending · ${period} · excluding transfers` });
}

export function EarningTab({ grain }: { grain: Grain }) {
  const endMonth = monthOf(todayIso());
  const cashFlowParams = { endMonth, months: grain === "year" ? 36 : 12 };
  const flow = useQuery<MonthTotals[]>("spending.cashFlow", cashFlowParams);
  const months = (flow.data?.value ?? []).map((m) => ({ period: m.month, incomeCents: m.incomeCents, spendingCents: m.spendingCents }));
  const ratesParams = { months, groupBy: grain };
  const rates = useQuery<{ rows: EarningRow[] }>("trajectory.earningVsSpending", ratesParams);
  const rows = (flow.data ? rates.data?.value.rows : undefined)?.filter((r) => r.incomeCents !== 0 || r.spendingCents !== 0);

  if (flow.error && !flow.data) return <p className="rti-error">Couldn't load income and spending: {flow.error.message}</p>;
  if (!rows) return <p className="rti-note">Loading…</p>;
  if (rows.length === 0) return <ConnectEmptyState icon="spending" title="No income or spending yet" description="Once transactions import, income and spending show here month by month." />;

  const onClick = (p: unknown) => {
    const e = p as { dataIndex: number; seriesName: string };
    const r = rows[e.dataIndex];
    if (!r) return;
    if (e.seriesName === "Income") drillEarning(r.period, "income", cashFlowParams);
    if (e.seriesName === "Spending") drillEarning(r.period, "spending", cashFlowParams);
  };

  return (
    <div className="rti-stack">
      <div className="rti-chart">
        <Chart option={earningOption(rows)} ariaLabel={`Income and spending per ${grain}, with the savings rate`} onEvents={{ click: onClick }} />
      </div>
      <p className="rti-note">Income above the line, spending below; the line is the savings rate. Click a bar or an amount to see its transactions.</p>
      <table className="rti-table" aria-label="Earning vs spending">
        <thead>
          <tr>
            <th scope="col">{grain === "year" ? "Year" : "Month"}</th>
            <th scope="col" className="is-num">Income</th>
            <th scope="col" className="is-num">Spending</th>
            <th scope="col" className="is-num">Saved</th>
            <th scope="col" className="is-num">Savings rate</th>
            <th scope="col" className="is-num">Spending share</th>
          </tr>
        </thead>
        <tbody>
          {[...rows].reverse().map((r) => (
            <tr key={r.period}>
              <th scope="row">
                {periodLabel(r.period)}
                {r.period === endMonth || r.period === endMonth.slice(0, 4) ? <span className="rti-note"> (so far)</span> : null}
              </th>
              <td className="is-num rti-num">
                <button type="button" className="rti-link" onClick={() => drillEarning(r.period, "income", cashFlowParams)} aria-label={`Income ${periodLabel(r.period)}: ${money(r.incomeCents)}. Show transactions`}>
                  {money(r.incomeCents)}
                </button>
              </td>
              <td className="is-num rti-num">
                <button type="button" className="rti-link" onClick={() => drillEarning(r.period, "spending", cashFlowParams)} aria-label={`Spending ${periodLabel(r.period)}: ${money(r.spendingCents)}. Show transactions`}>
                  {money(r.spendingCents)}
                </button>
              </td>
              <td className={`is-num rti-num${r.savedCents < 0 ? " rti-num--neg" : ""}`}>{money(r.savedCents)}</td>
              <td className="is-num rti-num">{pct(r.savingsRate)}</td>
              <td className="is-num rti-num">{pct(r.spendingShare)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
