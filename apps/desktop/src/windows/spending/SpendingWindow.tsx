/**
 * Spending (§8): "Where did my money go this month?"
 *
 * Primary: the month's summary and its flow diagram. Everything else (per
 * category, merchants, calendar, saving, necessary, worth a look) sits behind
 * tabs (§15). Every figure drills down to the Transactions window.
 */
import { useState } from "react";
import { addMonthsToMonth, monthOf } from "@ft/core";
import { monthLong, monthShort, todayIso } from "../../data/dates.ts";
import { useCategoryColors } from "../../data/useCategoryColors.ts";
import { Button, SegmentedControl, Tabs } from "../../ui/components.tsx";
import { CalendarPanel } from "./CalendarPanel.tsx";
import { CategoriesPanel } from "./CategoriesPanel.tsx";
import { MerchantsPanel } from "./MerchantsPanel.tsx";
import { NecessaryPanel } from "./NecessaryPanel.tsx";
import { SankeyPanel } from "./SankeyPanel.tsx";
import { SavingPanel } from "./SavingPanel.tsx";
import { Summary } from "./Summary.tsx";
import { WorthALookPanel } from "./WorthALookPanel.tsx";
import "../transactions/transactions.css";
import "./spending.css";

export type SpendingTab = "flow" | "categories" | "merchants" | "calendar" | "saving" | "necessary" | "worth";

const TABS: { value: SpendingTab; label: string }[] = [
  { value: "flow", label: "Flow" },
  { value: "categories", label: "Categories" },
  { value: "merchants", label: "Merchants" },
  { value: "calendar", label: "Calendar" },
  { value: "saving", label: "Saving" },
  { value: "necessary", label: "Necessary?" },
  { value: "worth", label: "Worth a look" },
];

export function SpendingWindow({ initialMonth }: { initialMonth?: string } = {}) {
  const thisMonth = monthOf(todayIso());
  const [month, setMonth] = useState<string>(initialMonth ?? thisMonth);
  const [usual, setUsual] = useState<"1" | "2" | "3">("3");
  const [tab, setTab] = useState<SpendingTab>("flow");
  useCategoryColors();
  const usualMonths = Number(usual) as 1 | 2 | 3;
  const prev = addMonthsToMonth(month, -1);
  const next = addMonthsToMonth(month, 1);
  return (
    <div className="sp-window">
      <header className="sp-header">
        <div className="sp-month" role="group" aria-label="Month">
          <Button size="sm" variant="ghost" onClick={() => setMonth(prev)} aria-label={`Previous month, ${monthLong(prev)}`}>
            ← {monthShort(prev)}
          </Button>
          <h2 className="sp-month__label" aria-live="polite">
            {monthLong(month)}
          </h2>
          <Button size="sm" variant="ghost" disabled={month >= thisMonth} onClick={() => setMonth(next)} aria-label={`Next month, ${monthLong(next)}`}>
            {monthShort(next)} →
          </Button>
        </div>
        <span className="tx-spacer" />
        <label className="sp-usual">
          <span className="tx-muted tx-small">Compare with usual =</span>
          <SegmentedControl
            size="sm"
            label="Usual is the average of the previous"
            value={usual}
            onChange={setUsual}
            options={[
              { value: "1", label: "1 month" },
              { value: "2", label: "2 months" },
              { value: "3", label: "3 months" },
            ]}
          />
        </label>
      </header>
      <Summary month={month} usualMonths={usualMonths} />
      <Tabs label="Spending views" tabs={TABS} value={tab} onChange={setTab} />
      <div className="sp-body" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === "flow" && <SankeyPanel month={month} />}
        {tab === "categories" && <CategoriesPanel month={month} usualMonths={usualMonths} />}
        {tab === "merchants" && <MerchantsPanel month={month} />}
        {tab === "calendar" && <CalendarPanel month={month} />}
        {tab === "saving" && <SavingPanel month={month} />}
        {tab === "necessary" && <NecessaryPanel month={month} />}
        {tab === "worth" && <WorthALookPanel month={month} usualMonths={usualMonths} />}
      </div>
    </div>
  );
}
