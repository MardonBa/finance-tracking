/**
 * Trajectory (§12): "Where is my net worth heading?" Looking back (net worth,
 * earning vs spending, investments, interest) and looking forward (the
 * projection), one view per tab to stay uncluttered (§15).
 */
import { useState } from "react";
import { monthOf } from "@ft/core";
import { SegmentedControl, Tabs } from "../../ui/components.tsx";
import { EarningTab } from "./EarningTab.tsx";
import { GrowthTab } from "./GrowthTab.tsx";
import { InterestTab } from "./InterestTab.tsx";
import { NetWorthTab } from "./NetWorthTab.tsx";
import { ProjectionTab } from "./ProjectionTab.tsx";
import type { Grain } from "./types.ts";
import "../shared/shared.css";
import "./trajectory.css";
import { ExplainButton } from "../shared/ExplainButton.tsx";
import type { ExplainFigure } from "../assistant/explain.ts";
import { todayIso } from "../../data/dates.ts";

type Tab = "networth" | "projection" | "earning" | "investments" | "interest";

const TABS = [
  { value: "networth", label: "Net worth" },
  { value: "projection", label: "Projection" },
  { value: "earning", label: "Earning vs spending" },
  { value: "investments", label: "Investments" },
  { value: "interest", label: "Interest" },
] as const;

/** What "Explain" asks the assistant about on each tab: the query behind that tab's main chart. */
function explainFor(tab: Tab): ExplainFigure {
  switch (tab) {
    case "networth":
      return { query: "balances.netWorth", params: { includeHidden: false }, label: "my net worth" };
    case "projection":
      return { query: "trajectory.assumptions", params: {}, label: "my projection's assumptions" };
    case "earning":
      return { query: "spending.cashFlow", params: { endMonth: monthOf(todayIso()), months: 12 }, label: "earning vs spending over the last 12 months" };
    case "investments":
      return { query: "trajectory.investmentGrowth", params: {}, label: "what I put in vs growth" };
    case "interest":
      return { query: "trajectory.interest", params: {}, label: "interest earned vs principal" };
  }
}

const GRAINS = [
  { value: "month", label: "By month" },
  { value: "year", label: "By year" },
] as const;

export function TrajectoryWindow() {
  const [tab, setTab] = useState<Tab>("networth");
  const [grain, setGrain] = useState<Grain>("month");
  return (
    <div className="rti-window">
      <div className="rti-window__top">
        <div className="rti-toolbar">
          <Tabs label="Trajectory views" tabs={TABS} value={tab} onChange={setTab} />
          <span className="rti-toolbar__spacer" />
          {tab !== "projection" && <SegmentedControl label="Period" size="sm" options={GRAINS} value={grain} onChange={setGrain} />}
          <ExplainButton figure={explainFor(tab)} />
        </div>
      </div>
      <div className="rti-scroll" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === "networth" && <NetWorthTab grain={grain} />}
        {tab === "projection" && <ProjectionTab />}
        {tab === "earning" && <EarningTab grain={grain} />}
        {tab === "investments" && <GrowthTab grain={grain} />}
        {tab === "interest" && <InterestTab grain={grain} />}
      </div>
    </div>
  );
}
