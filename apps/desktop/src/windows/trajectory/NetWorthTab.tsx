/**
 * Net worth over time (§5 "Seeing it", §12): stacked by account (assets
 * above zero, debts below), hover shows date + each account + total, a
 * toggle between all accounts and grouped by type, estimated history marked
 * and where each account's history starts.
 */
import { useState } from "react";
import { addMonths } from "@ft/core";
import { useQuery } from "../../data/hooks.ts";
import { Chart } from "../../ui/Chart.tsx";
import { SegmentedControl, StatNumber } from "../../ui/components.tsx";
import { longDate, money, todayIso } from "../shared/format.ts";
import { netWorthOption } from "./charts.ts";
import type { Grain, NetWorthChart } from "./types.ts";
import { ConnectEmptyState } from "../shared/ConnectEmptyState.tsx";

const GROUPINGS = [
  { value: "account", label: "All accounts" },
  { value: "type", label: "By type" },
] as const;

export function NetWorthTab({ grain }: { grain: Grain }) {
  const [grouping, setGrouping] = useState<"account" | "type">("account");
  const to = todayIso();
  // TODO(revisit): month view covers 24 months (month-end points), year view 10 years (year-end points).
  const from = addMonths(to, grain === "year" ? -120 : -24);
  const q = useQuery<NetWorthChart>("balances.netWorthChart", { from, to, grouping, fill: "carry", includeHidden: false });
  const chart = q.data?.value;
  const last = chart?.points.at(-1);
  const estimated = chart?.historyStarts.filter((h) => h.estimatedUntil) ?? [];

  if (q.error && !chart) return <p className="rti-error">Couldn't load net worth: {q.error.message}</p>;
  if (!chart) return <p className="rti-note">Loading…</p>;
  if (chart.series.length === 0)
    return <ConnectEmptyState icon="trajectory" title="No balance history yet" description="Net worth over time appears once accounts are connected and the daily snapshot has run." />;

  return (
    <div className="rti-stack">
      <div className="rti-toolbar">
        {last && <StatNumber label={`Net worth on ${longDate(last.date)}`} value={money(last.totalCents)} size="lg" />}
        <span className="rti-toolbar__spacer" />
        <SegmentedControl label="Show accounts" size="sm" options={GROUPINGS} value={grouping} onChange={setGrouping} />
      </div>
      <div className="rti-chart rti-chart--tall">
        <Chart option={netWorthOption(chart, grain)} ariaLabel={`Net worth over time, stacked ${grouping === "account" ? "by account" : "by type"}; debts below zero`} />
      </div>
      {estimated.length > 0 && (
        <p className="rti-note" data-testid="estimated-note">
          <span className="rti-badge rti-badge--estimate">Estimated</span> Shaded history is rebuilt from transactions, not real snapshots:{" "}
          {estimated.map((h) => `${h.label} until ${longDate(h.estimatedUntil!)}`).join("; ")}.
        </p>
      )}
      <details className="rti-details" open>
        <summary>Where each account's history starts</summary>
        <ul aria-label="Where each account's history starts">
          {chart.historyStarts.map((h) => (
            <li key={h.accountId}>
              <b>{h.label}</b>: {h.startsOn ? `history starts here, ${longDate(h.startsOn)}` : "no history yet"}. {h.reason}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
