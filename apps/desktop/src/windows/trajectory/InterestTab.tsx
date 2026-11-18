/**
 * Interest vs principal (§12): for the HYSA and any interest-earning account,
 * principal deposited vs total interest earned (cumulative), plus interest
 * per month or year. Interest amounts drill down to their transactions.
 */
import { openDrillDown } from "../../data/drilldown.ts";
import { useQuery } from "../../data/hooks.ts";
import { Chart } from "../../ui/Chart.tsx";
import { Card, EmptyState, StatNumber } from "../../ui/components.tsx";
import { color } from "../../ui/tokens.ts";
import { money, moneyShort } from "../shared/format.ts";
import { periodLabel } from "./charts.ts";
import type { Grain, InterestValue } from "./types.ts";

type Acc = InterestValue["accounts"][number];

function cumulativeOption(a: Acc) {
  const labels = a.months.map((m) => periodLabel(m.month));
  return {
    grid: { left: 8, right: 8, top: 28, bottom: 8, containLabel: true },
    legend: { top: 0 },
    tooltip: { trigger: "axis", valueFormatter: (v: number) => money(Math.round(v * 100)) },
    xAxis: { type: "category", data: labels },
    yAxis: [
      { type: "value", name: "Principal", axisLabel: { formatter: (v: number) => moneyShort(v * 100) } },
      { type: "value", name: "Interest", axisLabel: { formatter: (v: number) => moneyShort(v * 100) }, splitLine: { show: false } },
    ],
    series: [
      { name: "Principal put in", type: "line", data: a.months.map((m) => m.principalCents / 100), lineStyle: { color: color["accent-blue"] }, itemStyle: { color: color["accent-blue"] } },
      {
        name: "Total interest earned",
        type: "line",
        yAxisIndex: 1,
        data: a.months.map((m) => m.totalInterestCents / 100),
        lineStyle: { color: color["pink-600"] },
        itemStyle: { color: color["pink-600"] },
        areaStyle: { color: color["pink-100"], opacity: 0.7 },
      },
    ],
  };
}

function perPeriod(a: Acc, grain: Grain) {
  return grain === "year" ? a.years.map((y) => ({ key: y.year, cents: y.interestCents })) : a.months.map((m) => ({ key: m.month, cents: m.interestCents }));
}

function barsOption(rows: Array<{ key: string; cents: number }>) {
  return {
    grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true },
    tooltip: { trigger: "axis", valueFormatter: (v: number) => money(Math.round(v * 100)) },
    xAxis: { type: "category", data: rows.map((r) => periodLabel(r.key)) },
    yAxis: { type: "value", axisLabel: { formatter: (v: number) => moneyShort(v * 100) } },
    series: [{ name: "Interest earned", type: "bar", data: rows.map((r) => r.cents / 100), itemStyle: { color: color["pink-600"] }, cursor: "pointer" }],
  };
}

export function InterestTab({ grain }: { grain: Grain }) {
  const q = useQuery<InterestValue>("trajectory.interest", {});
  if (q.error && !q.data) return <p className="rti-error">Couldn't load interest: {q.error.message}</p>;
  if (!q.data) return <p className="rti-note">Loading…</p>;
  const { accounts } = q.data.value;
  const figures = q.data.figures;
  if (accounts.length === 0) return <EmptyState icon="trajectory" title="No interest-earning accounts" description="A savings account (like a HYSA) shows here with the interest it has earned." />;

  const drill = (a: Acc, key: string, label: string) => {
    const figureId = `interest.${a.accountId}.${key}`;
    if (figureId in figures) openDrillDown({ query: "trajectory.interest", params: {}, figureId, label });
  };

  return (
    <div className="rti-stack">
      {accounts.map((a) => {
        const rows = perPeriod(a, grain);
        return (
          <Card key={a.accountId} title={a.accountName}>
            <div className="rti-stack">
              <div className="rti-row">
                <StatNumber label="Total interest earned" value={money(a.totalInterestCents)} onDrillDown={() => drill(a, "total", `${a.accountName} interest · all time`)} />
                <StatNumber label="Principal put in" value={money(a.principalCents)} detail="starting balance plus deposits minus withdrawals" />
              </div>
              {a.months.length > 0 && (
                <div className="rti-chart rti-chart--small">
                  <Chart option={cumulativeOption(a)} ariaLabel={`${a.accountName}: cumulative principal vs total interest`} />
                </div>
              )}
              {rows.length > 0 && (
                <>
                  <h4 className="rti-note">Interest per {grain}</h4>
                  <div className="rti-chart rti-chart--small">
                    <Chart
                      option={barsOption(rows)}
                      ariaLabel={`${a.accountName}: interest earned per ${grain}`}
                      onEvents={{
                        click: (p) => {
                          const r = rows[(p as { dataIndex: number }).dataIndex];
                          if (r) drill(a, r.key, `${a.accountName} interest · ${periodLabel(r.key)}`);
                        },
                      }}
                    />
                  </div>
                </>
              )}
              <p className="rti-note">History goes back as far as the account's transactions do.</p>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
