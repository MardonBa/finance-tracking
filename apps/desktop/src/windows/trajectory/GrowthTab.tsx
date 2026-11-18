/**
 * Investments over time (§12): value split into what I put in (transfers in
 * minus out) and growth, from when each account's history starts (§5).
 */
import { useQuery } from "../../data/hooks.ts";
import { Chart } from "../../ui/Chart.tsx";
import { Card, StatNumber } from "../../ui/components.tsx";
import { color } from "../../ui/tokens.ts";
import { longDate, money, moneyShort, monthShort } from "../shared/format.ts";
import { downsample } from "./charts.ts";
import type { Grain, InvestmentGrowthValue } from "./types.ts";
import { ConnectEmptyState } from "../shared/ConnectEmptyState.tsx";

type Acc = InvestmentGrowthValue["accounts"][number];

export function growthOption(a: Acc, grain: Grain) {
  const pts = downsample(a.points, grain);
  const labels = pts.map((p) => (grain === "year" ? p.date.slice(0, 4) : monthShort(p.date.slice(0, 7))));
  return {
    grid: { left: 8, right: 16, top: 28, bottom: 8, containLabel: true },
    legend: { top: 0 },
    tooltip: {
      trigger: "axis",
      formatter: (params: Array<{ dataIndex: number }>) => {
        const p = pts[params[0]?.dataIndex ?? 0];
        if (!p) return "";
        return [`<b>${longDate(p.date)}</b>`, `Value: <b>${money(p.valueCents)}</b>`, `What you put in: ${money(p.contributedCents)}`, `Growth: ${money(p.growthCents, { showPlus: true })}`].join("<br/>");
      },
    },
    xAxis: { type: "category", data: labels, boundaryGap: false },
    yAxis: { type: "value", axisLabel: { formatter: (v: number) => moneyShort(v * 100) } },
    series: [
      {
        name: "What you put in",
        type: "line",
        symbol: "none",
        data: pts.map((p) => p.contributedCents / 100),
        lineStyle: { color: color["orange-600"], type: "dashed" },
        itemStyle: { color: color["orange-600"] },
        areaStyle: { color: color["orange-100"], opacity: 0.8 },
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: color["text-muted"], type: "dotted" },
          label: { color: color["text-muted"], formatter: "History starts", position: "insideEndTop" },
          data: labels.length ? [{ xAxis: labels[0] }] : [],
        },
      },
      { name: "Value", type: "line", symbol: "none", data: pts.map((p) => p.valueCents / 100), lineStyle: { color: color["accent-blue"], width: 2 }, itemStyle: { color: color["accent-blue"] } },
    ],
  };
}

export function GrowthTab({ grain }: { grain: Grain }) {
  const q = useQuery<InvestmentGrowthValue>("trajectory.investmentGrowth", {});
  if (q.error && !q.data) return <p className="rti-error">Couldn't load investments: {q.error.message}</p>;
  if (!q.data) return <p className="rti-note">Loading…</p>;
  const accounts = q.data.value.accounts;
  if (accounts.length === 0) return <ConnectEmptyState icon="investments" title="No investment accounts" description="Connect a brokerage or retirement account to see what you put in and how it grew." />;
  return (
    <div className="rti-stack">
      {accounts.map((a) => {
        const last = a.points.at(-1);
        return (
          <Card key={a.accountId} title={a.accountName}>
            <div className="rti-stack">
              {last ? (
                <div className="rti-row">
                  <StatNumber label="Value" value={money(last.valueCents)} />
                  <StatNumber label="What you put in" value={money(last.contributedCents)} />
                  <StatNumber label="Growth" value={money(last.growthCents, { showPlus: true })} detail="market gains, losses and dividends" />
                </div>
              ) : null}
              {a.points.length > 1 && (
                <div className="rti-chart rti-chart--small">
                  <Chart option={growthOption(a, grain)} ariaLabel={`${a.accountName}: value vs what you put in`} />
                </div>
              )}
              <p className="rti-note">
                {a.historyStartsOn
                  ? `History starts here: ${longDate(a.historyStartsOn)}, when the account was connected. The value then (${money(a.startingValueCents)}) counts as what you put in.`
                  : "No value history yet; it starts with the next daily snapshot."}
              </p>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
