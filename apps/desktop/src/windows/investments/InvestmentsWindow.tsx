/**
 * Investments (§17): "How are my investments doing?" Holdings per account,
 * allocation, performance vs what I put in, and the activity list with
 * notes, one per tab (§15).
 */
import { useState } from "react";
import type { Investments } from "@ft/core";
import { useQuery } from "../../data/hooks.ts";
import { Chart } from "../../ui/Chart.tsx";
import { OTHER_COLOR } from "../../ui/colorMap.ts";
import { Card, SegmentedControl, StatNumber, Tabs } from "../../ui/components.tsx";
import { color, seriesColors } from "../../ui/tokens.ts";
import { longDate, money, moneyShort, pct, shortDate } from "../shared/format.ts";
import { ActivityTab } from "./ActivityTab.tsx";
import "../shared/shared.css";
import { ExplainButton } from "../shared/ExplainButton.tsx";
import { ConnectEmptyState } from "../shared/ConnectEmptyState.tsx";

type Tab = "holdings" | "allocation" | "performance" | "activity";
const TABS = [
  { value: "holdings", label: "Holdings" },
  { value: "allocation", label: "Allocation" },
  { value: "performance", label: "Performance" },
  { value: "activity", label: "Activity" },
] as const;

type HoldingsValue = { accounts: Investments.AccountHoldings[] };
type AllocationValue = { totalCents: number; byType: Investments.AllocationSlice[]; byHolding: Investments.AllocationSlice[] };
type PerformanceValue = { accounts: Investments.Performance[]; total: Investments.Performance };
type HistoryValue = { accounts: Investments.HoldingsHistory[] };

const NONE = <ConnectEmptyState icon="investments" title="No investment accounts yet" description="Connect a brokerage or retirement account to see holdings, allocation and performance." />;

function HoldingsTab() {
  const q = useQuery<HoldingsValue>("investments.holdings", {});
  const hist = useQuery<HistoryValue>("investments.history", {});
  if (q.error && !q.data) return <p className="rti-error">Couldn't load holdings: {q.error.message}</p>;
  if (!q.data) return <p className="rti-note">Loading…</p>;
  const accounts = q.data.value.accounts;
  if (accounts.length === 0) return NONE;
  const total = accounts.reduce((s, a) => s + a.totalValueCents, 0);
  return (
    <div className="rti-stack">
      <StatNumber label="All investments" value={money(total)} size="lg" />
      {accounts.map((a) => {
        const start = hist.data?.value.accounts.find((h) => h.accountId === a.accountId)?.historyStartsOn;
        return (
          <Card key={a.accountId} title={a.accountName} actions={<span className="rti-num" style={{ fontWeight: "var(--weight-bold)" }}>{money(a.totalValueCents)}</span>}>
            {a.holdings.length === 0 ? (
              <p className="rti-note">No holdings reported yet{a.asOfDate ? "" : "; the value is the account balance"}.</p>
            ) : (
              <table className="rti-table" aria-label={`${a.accountName} holdings`}>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Ticker</th>
                    <th scope="col" className="is-num">Quantity</th>
                    <th scope="col" className="is-num">Value</th>
                    <th scope="col" className="is-num">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {a.holdings.map((h) => (
                    <tr key={h.securityId}>
                      <td>{h.name}</td>
                      <td>{h.ticker ?? "–"}</td>
                      <td className="is-num rti-num">{h.quantity.toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
                      <td className="is-num rti-num">{money(h.valueCents)}</td>
                      <td className="is-num rti-num">{pct(h.shareOfAccount, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="rti-note" style={{ marginTop: "var(--space-2)" }}>
              {a.asOfDate ? `As of ${longDate(a.asOfDate)}. ` : ""}
              {start ? `Holdings history starts ${longDate(start)}, when the account was connected.` : "Holdings history starts with the next sync."}
            </p>
          </Card>
        );
      })}
    </div>
  );
}

function donut(slices: Array<{ label: string; valueCents: number }>, name: string) {
  return {
    tooltip: { trigger: "item", formatter: (p: { name: string; value: number; percent: number }) => `${p.name}: ${money(Math.round(p.value * 100))} (${p.percent}%)` },
    legend: { type: "scroll", orient: "vertical", right: 0, top: "middle" },
    series: [
      {
        name,
        type: "pie",
        radius: ["45%", "75%"],
        center: ["35%", "50%"],
        label: { show: false },
        data: slices.map((s, i) => ({ name: s.label, value: s.valueCents / 100, itemStyle: { color: i < seriesColors.length ? seriesColors[i] : OTHER_COLOR } })),
      },
    ],
  };
}

/** Biggest holdings get their own slice; the rest share "Other" (§15 small multiples over rainbow stacks). */
export function foldHoldings(slices: readonly Investments.AllocationSlice[], max = seriesColors.length - 1) {
  if (slices.length <= max + 1) return [...slices];
  const rest = slices.slice(max);
  const v = rest.reduce((s, x) => s + x.valueCents, 0);
  return [...slices.slice(0, max), { key: "__other__", label: `Other (${rest.length})`, valueCents: v, share: rest.reduce((s, x) => s + x.share, 0) }];
}

function AllocationTab() {
  const [by, setBy] = useState<"type" | "holding">("type");
  const q = useQuery<AllocationValue>("investments.allocation", {});
  if (q.error && !q.data) return <p className="rti-error">Couldn't load allocation: {q.error.message}</p>;
  if (!q.data) return <p className="rti-note">Loading…</p>;
  const v = q.data.value;
  if (v.totalCents === 0) return NONE;
  const slices = by === "type" ? v.byType : foldHoldings(v.byHolding);
  const rows = by === "type" ? v.byType : v.byHolding;
  return (
    <div className="rti-stack">
      <div className="rti-toolbar">
        <StatNumber label="Total invested value" value={money(v.totalCents)} />
        <span className="rti-toolbar__spacer" />
        <SegmentedControl label="Break down by" size="sm" options={[{ value: "type", label: "By type" }, { value: "holding", label: "By holding" }]} value={by} onChange={setBy} />
      </div>
      <div className="rti-chart">
        <Chart option={donut(slices, by === "type" ? "By type" : "By holding")} ariaLabel={`Allocation ${by === "type" ? "by type" : "by holding"}`} />
      </div>
      <table className="rti-table" aria-label={`Allocation ${by === "type" ? "by type" : "by holding"}`}>
        <thead>
          <tr>
            <th scope="col">{by === "type" ? "Type" : "Holding"}</th>
            <th scope="col" className="is-num">Value</th>
            <th scope="col" className="is-num">Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.key}>
              <td>{s.label}</td>
              <td className="is-num rti-num">{money(s.valueCents)}</td>
              <td className="is-num rti-num">{pct(s.share, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function historyOption(h: Investments.HoldingsHistory, label: string) {
  const labels = h.points.map((p) => shortDate(p.date));
  return {
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
    tooltip: { trigger: "axis", valueFormatter: (v: number) => money(Math.round(v * 100)) },
    xAxis: { type: "category", data: labels, boundaryGap: false },
    yAxis: { type: "value", axisLabel: { formatter: (v: number) => moneyShort(v * 100) } },
    series: [
      {
        name: label,
        type: "line",
        symbol: "none",
        data: h.points.map((p) => p.valueCents / 100),
        lineStyle: { color: color["accent-blue"] },
        itemStyle: { color: color["accent-blue"] },
        areaStyle: { color: color["accent-blue-soft"], opacity: 0.6 },
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: color["text-muted"], type: "dotted" },
          label: { color: color["text-muted"], formatter: "History starts", position: "insideEndTop" },
          data: labels.length ? [{ xAxis: labels[0] }] : [],
        },
      },
    ],
  };
}

function gainText(p: Investments.Performance) {
  return `${money(p.gainCents, { showPlus: true })}${p.gainPct === null ? "" : ` (${p.gainPct >= 0 ? "+" : ""}${(p.gainPct * 100).toFixed(1)}%)`}`;
}

function PerformanceTab() {
  const q = useQuery<PerformanceValue>("investments.performance", {});
  const hist = useQuery<HistoryValue>("investments.history", {});
  if (q.error && !q.data) return <p className="rti-error">Couldn't load performance: {q.error.message}</p>;
  if (!q.data) return <p className="rti-note">Loading…</p>;
  const { accounts, total } = q.data.value;
  if (accounts.length === 0) return NONE;
  return (
    <div className="rti-stack">
      <div className="rti-row">
        <StatNumber label="All investments now" value={money(total.valueCents)} size="lg" />
        <StatNumber label="What you put in" value={money(total.contributedCents)} detail="value when history starts + transfers in − transfers out" />
        <StatNumber label="Gain or loss" value={gainText(total)} detail={total.gainCents >= 0 ? "gain" : "loss"} />
      </div>
      <table className="rti-table" aria-label="Performance per account">
        <thead>
          <tr>
            <th scope="col">Account</th>
            <th scope="col" className="is-num">Put in</th>
            <th scope="col" className="is-num">Value</th>
            <th scope="col" className="is-num">Gain / loss</th>
            <th scope="col">Measured from</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((p) => (
            <tr key={p.accountId}>
              <th scope="row">{p.label}</th>
              <td className="is-num rti-num">{money(p.contributedCents)}</td>
              <td className="is-num rti-num">{money(p.valueCents)}</td>
              <td className={`is-num rti-num ${p.gainCents < 0 ? "rti-num--neg" : "rti-num--pos"}`}>{gainText(p)}</td>
              <td>{p.historyStartsOn ? longDate(p.historyStartsOn) : "–"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <td className="is-num rti-num">{money(total.contributedCents)}</td>
            <td className="is-num rti-num">{money(total.valueCents)}</td>
            <td className="is-num rti-num">{gainText(total)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
      <p className="rti-note">
        What you put in is measured from transfers into and out of each account, not from the brokerage's cost basis. History starts when each account was
        connected; the value on that day counts as what you put in. {total.note}
      </p>
      {hist.data?.value.accounts
        .filter((h) => h.points.length > 1)
        .map((h) => {
          const label = accounts.find((a) => a.accountId === h.accountId)?.label ?? h.accountId;
          return (
            <Card key={h.accountId} title={`${label}: value since connecting`}>
              <div className="rti-chart rti-chart--small">
                <Chart option={historyOption(h, label)} ariaLabel={`${label} value over time, history starts ${h.historyStartsOn ?? "unknown"}`} />
              </div>
            </Card>
          );
        })}
    </div>
  );
}

export function InvestmentsWindow() {
  const [tab, setTab] = useState<Tab>("holdings");
  return (
    <div className="rti-window">
      <div className="rti-window__top">
        <div className="rti-toolbar">
          <Tabs label="Investment views" tabs={TABS} value={tab} onChange={setTab} />
          <span className="rti-toolbar__spacer" />
          <ExplainButton figure={{ query: "investments.performance", params: {}, label: "my investments' performance" }} />
        </div>
      </div>
      <div className="rti-scroll" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === "holdings" && <HoldingsTab />}
        {tab === "allocation" && <AllocationTab />}
        {tab === "performance" && <PerformanceTab />}
        {tab === "activity" && <ActivityTab />}
      </div>
    </div>
  );
}
