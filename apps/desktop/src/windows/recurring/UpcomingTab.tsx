/**
 * "Will I be covered?" (§9): per paying account, today's balance, every
 * charge (and card statement) due before the next income, the lowest point
 * and what the projection is based on.
 */
import { openDrillDown } from "../../data/drilldown.ts";
import { Chart } from "../../ui/Chart.tsx";
import { Card, EmptyState, StatNumber, StatusLabel } from "../../ui/components.tsx";
import { color } from "../../ui/tokens.ts";
import { dayDate, longDate, money, moneyShort, shortDate } from "../shared/format.ts";
import type { AccountProjection, ProjectionEvent, UpcomingValue } from "./types.ts";

const FIGURE_QUERY = "recurring.upcoming";

function basedOnFigure(e: ProjectionEvent, figures: Record<string, unknown>): string | null {
  if (!e.recurringItemId) return null;
  const id = `occurrences.${e.recurringItemId}`;
  return id in figures ? id : null;
}

function balanceOption(p: AccountProjection) {
  const dates = ["Today", ...p.events.map((e) => shortDate(e.date))];
  const values = [p.currentBalanceCents, ...p.events.map((e) => e.balanceAfterCents)].map((c) => c / 100);
  const below = values.some((v) => v < 0);
  return {
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
    tooltip: {
      trigger: "axis",
      valueFormatter: (v: number) => money(Math.round(v * 100)),
    },
    xAxis: { type: "category", data: dates, boundaryGap: false },
    yAxis: { type: "value", axisLabel: { formatter: (v: number) => moneyShort(v * 100) } },
    series: [
      {
        name: "Projected balance",
        type: "line",
        step: "end",
        data: values,
        lineStyle: { color: color["accent-blue"], width: 2 },
        itemStyle: { color: color["accent-blue"] },
        areaStyle: { color: color["accent-blue-soft"], opacity: 0.6 },
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: below ? color["status-danger"] : color["text-muted"], type: "dashed" },
          label: { formatter: "$0", color: color["text-muted"] },
          data: [{ yAxis: 0 }],
        },
      },
    ],
  };
}

function ProjectionCard({ p, figures }: { p: AccountProjection; figures: Record<string, unknown> }) {
  const low = p.lowestPoint;
  return (
    <Card title={p.accountName}>
      <div className="rti-stack">
        <div className="rti-row">
          <StatNumber label="Balance today" value={money(p.currentBalanceCents)} size="lg" />
          <StatNumber
            label="Lowest point"
            value={money(low.cents)}
            detail={
              <span>
                {low.cents < 0 ? <StatusLabel status="warning">Below zero</StatusLabel> : <StatusLabel status="on-track">Covered</StatusLabel>}{" "}
                on {longDate(low.date)}
              </span>
            }
          />
          <StatNumber
            label="Next income"
            value={p.nextIncome ? money(p.nextIncome.amountCents) : "None expected"}
            detail={p.nextIncome ? `${p.nextIncome.name} · ${longDate(p.nextIncome.date)}` : undefined}
          />
        </div>
        <p className="rti-note">{p.windowReason}</p>
        {p.events.length > 0 && (
          <div className="rti-chart rti-chart--small">
            <Chart option={balanceOption(p)} ariaLabel={`Projected balance of ${p.accountName}, lowest ${money(low.cents)} on ${longDate(low.date)}`} />
          </div>
        )}
        {p.events.length === 0 ? (
          <p className="rti-note">Nothing is due before then.</p>
        ) : (
          <table className="rti-table" aria-label={`Coming out of ${p.accountName}`}>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">What</th>
                <th scope="col" className="is-num">
                  Amount
                </th>
                <th scope="col" className="is-num">
                  Balance after
                </th>
              </tr>
            </thead>
            <tbody>
              {p.events.map((e, i) => {
                const fig = basedOnFigure(e, figures);
                return (
                  <tr key={`${e.date}-${e.name}-${i}`}>
                    <td>{dayDate(e.date)}</td>
                    <td>
                      {fig ? (
                        <button
                          type="button"
                          className="rti-link"
                          title="Show the past payments this is based on"
                          onClick={() => openDrillDown({ query: FIGURE_QUERY, params: {}, figureId: fig, label: `Past ${e.name} payments` })}
                        >
                          {e.name}
                        </button>
                      ) : (
                        e.name
                      )}{" "}
                      {e.kind === "card_payment" && <span className="rti-badge rti-badge--accent">Card statement</span>}
                      {e.kind === "income" && <span className="rti-badge rti-badge--accent">Income</span>}
                      {e.isEstimate && <span className="rti-badge rti-badge--estimate">Estimate</span>}
                    </td>
                    <td className="is-num rti-num">{money(e.amountCents, { showPlus: true })}</td>
                    <td className={`is-num rti-num${e.balanceAfterCents < 0 ? " rti-num--neg" : ""}`}>
                      {money(e.balanceAfterCents)}
                      {e.balanceAfterCents < 0 && <span className="ui-visually-hidden"> (below zero)</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <details className="rti-details">
          <summary>What this is based on</summary>
          <ul>
            {p.basis.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </details>
      </div>
    </Card>
  );
}

export function UpcomingTab({ value, figures, onAdd }: { value: UpcomingValue; figures: Record<string, unknown>; onAdd: () => void }) {
  if (value.projections.length === 0) {
    return (
      <EmptyState
        icon="recurring"
        title="Nothing to project yet"
        description="Once a checking or savings account has a recurring bill, paycheck or card payment, you'll see whether it stays above zero until your next income."
        action={{ label: "Add a recurring charge", icon: "plus", onClick: onAdd }}
      />
    );
  }
  return (
    <div className="rti-stack">
      {value.projections.map((p) => (
        <ProjectionCard key={p.accountId} p={p} figures={figures} />
      ))}
    </div>
  );
}
