/**
 * Recurring (§9): "Will I be covered?" Below-zero warnings at the top; the
 * primary element is the upcoming view per paying account. The list and the
 * month calendar live behind tabs (§15 uncluttered).
 */
import { useState } from "react";
import { monthOf } from "@ft/core";
import { useQuery } from "../../data/hooks.ts";
import { EmptyState, Tabs } from "../../ui/components.tsx";
import { todayIso } from "../shared/format.ts";
import { CalendarTab } from "./CalendarTab.tsx";
import { ListTab, type Editing } from "./ListTab.tsx";
import { UpcomingTab } from "./UpcomingTab.tsx";
import { LowBalanceWarningsView } from "./warnings.tsx";
import type { AccountRow, ListValue, UpcomingValue } from "./types.ts";
import "../shared/shared.css";
import "./recurring.css";

type Tab = "upcoming" | "list" | "calendar";

const TABS = [
  { value: "upcoming", label: "Will I be covered?" },
  { value: "list", label: "All recurring" },
  { value: "calendar", label: "Month calendar" },
] as const;

export function RecurringWindow() {
  const [tab, setTab] = useState<Tab>("upcoming");
  const [editing, setEditing] = useState<Editing>(null);
  const [month, setMonth] = useState(() => monthOf(todayIso()));
  const upcoming = useQuery<UpcomingValue>("recurring.upcoming", {});
  const list = useQuery<ListValue>("recurring.list", {});
  const accounts = useQuery<{ accounts: AccountRow[] }>("accounts.list", { includeHidden: false });

  const error = upcoming.error ?? list.error;
  const firstLoad = !upcoming.data && upcoming.loading;

  return (
    <div className="rti-window">
      <div className="rti-window__top">
        {upcoming.data && <LowBalanceWarningsView warnings={upcoming.data.value.warnings} />}
        <Tabs label="Recurring views" tabs={TABS} value={tab} onChange={setTab} />
      </div>
      <div className="rti-scroll" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {error && !upcoming.data && (
          <EmptyState icon="warning" title="Couldn't load recurring charges" description={error.message} action={{ label: "Try again", onClick: () => (upcoming.refetch(), list.refetch()) }} />
        )}
        {firstLoad && <p className="rti-note">Loading…</p>}
        {tab === "upcoming" && upcoming.data && (
          <UpcomingTab
            value={upcoming.data.value}
            figures={upcoming.data.figures}
            onAdd={() => {
              setTab("list");
              setEditing({ mode: "add" });
            }}
          />
        )}
        {tab === "list" && list.data && (
          <ListTab
            value={list.data.value}
            figures={list.data.figures}
            accounts={accounts.data?.value.accounts ?? []}
            cardPayments={upcoming.data?.value.cardPayments ?? []}
            editing={editing}
            setEditing={setEditing}
          />
        )}
        {tab === "calendar" && <CalendarTab month={month} setMonth={setMonth} />}
      </div>
    </div>
  );
}
