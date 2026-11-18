/**
 * "How well do I stick to it?" (§10): planned vs actual for the last finished
 * period, the history grid (parts × periods, coloured by how far over or
 * under, always with the number and a sign), and the track record per part.
 */
import { useState } from "react";
import type { Budgets } from "@ft/core";
import { useQuery } from "../../data/hooks.ts";
import { openDrillDown } from "../../data/drilldown.ts";
import { SegmentedControl, StatusLabel } from "../../ui/components.tsx";
import { periodLabel, periodShort, usd } from "./format.ts";

export interface HistoryValue {
  periods: Budgets.Period[];
  rows: Budgets.PlanRow[];
}

/** Five bands by how far over/under; the cell always shows the number too. */
export function cellBand(c: Budgets.PlanCell): "none" | "well-under" | "under" | "near" | "over" | "well-over" {
  if (c.diffRatio === null) return "none";
  if (c.diffRatio <= -0.25) return "well-under";
  if (c.diffRatio < -0.05) return "under";
  if (c.diffRatio <= 0.05) return "near";
  if (c.diffRatio <= 0.25) return "over";
  return "well-over";
}

const pctText = (r: number | null) => (r === null ? "" : `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.round(Math.abs(r) * 100)}%`);
const diffText = (d: number | null) => (d === null ? "no plan" : d > 0 ? `${usd(d)} over` : d < 0 ? `${usd(-d)} under` : "on plan");

export function HistoryView({ budgetId, today }: { budgetId: string; today: string }) {
  const [count, setCount] = useState<"6" | "12">("6");
  const params = { budgetId, periods: Number(count) };
  const q = useQuery<HistoryValue | null>("budgets.history", params);
  const v = q.data?.value;
  if (q.error && !v) return <p className="bg-muted">Couldn't load the history: {q.error.message}</p>;
  if (!v) return <p className="bg-muted">Loading…</p>;

  const drill = (row: Budgets.PlanRow, c: Budgets.PlanCell) =>
    openDrillDown({ query: "budgets.history", params, figureId: c.figure, label: `${row.name} · ${periodLabel(c.period)}` });

  // The last finished period is the planned-vs-actual summary.
  const lastIdx = v.periods.map((p) => p.end < today).lastIndexOf(true);
  const lastPeriod = lastIdx >= 0 ? v.periods[lastIdx] : undefined;

  return (
    <div className="bg-history">
      <section aria-labelledby="bg-pva">
        <h3 id="bg-pva" className="bg-section-title">
          Planned vs actual{lastPeriod ? ` · ${periodLabel(lastPeriod)}` : ""}
        </h3>
        {!lastPeriod ? (
          <p className="bg-muted">No finished period yet. The first summary appears when this period ends.</p>
        ) : (
          <table className="bg-table">
            <thead>
              <tr>
                <th scope="col">Part</th>
                <th scope="col">Planned</th>
                <th scope="col">Actual</th>
                <th scope="col">Difference</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {v.rows.map((row) => {
                const c = row.cells[lastIdx];
                if (!c) return null;
                return (
                  <tr key={row.id} className={row.kind === "overall" ? "is-overall" : undefined}>
                    <th scope="row">{row.name}</th>
                    <td>{c.plannedCents === null ? "—" : usd(c.plannedCents)}</td>
                    <td>
                      <button type="button" className="bg-link-number" onClick={() => drill(row, c)} aria-label={`${row.name} actual ${usd(c.actualCents)}. Show transactions`}>
                        {usd(c.actualCents)}
                      </button>
                    </td>
                    <td>
                      {diffText(c.diffCents)} {c.diffRatio !== null && <span className="bg-muted">({pctText(c.diffRatio)})</span>}
                    </td>
                    <td>{c.within === null ? <span className="bg-muted">—</span> : c.within ? <StatusLabel status="under">Within plan</StatusLabel> : <StatusLabel status="over">Over</StatusLabel>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="bg-grid">
        <div className="bg-section-head">
          <h3 id="bg-grid" className="bg-section-title">
            History
          </h3>
          <SegmentedControl
            size="sm"
            label="How many periods"
            value={count}
            onChange={setCount}
            options={[
              { value: "6", label: "Last 6" },
              { value: "12", label: "Last 12" },
            ]}
          />
        </div>
        <div className="bg-grid-wrap">
          <table className="bg-grid">
            <thead>
              <tr>
                <th scope="col">Part</th>
                {v.periods.map((p) => (
                  <th scope="col" key={p.start}>
                    {periodShort(p)}
                  </th>
                ))}
                <th scope="col">Track record</th>
              </tr>
            </thead>
            <tbody>
              {v.rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row">{row.name}</th>
                  {row.cells.map((c) => {
                    const band = cellBand(c);
                    return (
                      <td key={c.period.start}>
                        <button
                          type="button"
                          className={`bg-cell bg-cell--${band}${c.period.end >= today ? " is-current" : ""}`}
                          onClick={() => drill(row, c)}
                          aria-label={`${row.name}, ${periodLabel(c.period)}: ${usd(c.actualCents)} actual, ${diffText(c.diffCents)}. Show transactions`}
                          title={`${usd(c.actualCents)} of ${c.plannedCents === null ? "no plan" : usd(c.plannedCents)}`}
                        >
                          <span className="bg-cell__value">{usd(c.actualCents)}</span>
                          <span className="bg-cell__diff">
                            {c.diffRatio === null ? "—" : c.diffCents! > 0 ? `▲ ${pctText(c.diffRatio)}` : `▼ ${pctText(c.diffRatio)}`}
                          </span>
                        </button>
                      </td>
                    );
                  })}
                  <td className="bg-track">
                    {row.track.periods === 0 ? (
                      <span className="bg-muted">No finished periods</span>
                    ) : (
                      <>
                        <strong>
                          {row.track.withinCount} of {row.track.periods}
                        </strong>{" "}
                        within plan
                        <br />
                        <span className="bg-muted">avg {diffText(row.track.averageDiffCents)}</span>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="bg-legend">
          <span className="bg-cell bg-cell--well-under bg-legend__swatch">▼ 25%+</span> well under
          <span className="bg-cell bg-cell--near bg-legend__swatch">≈</span> near plan
          <span className="bg-cell bg-cell--well-over bg-legend__swatch">▲ 25%+</span> well over · the current period is outlined
        </p>
      </section>
    </div>
  );
}
