/**
 * Budgets window (§10): "Am I on budget this period?"
 *
 * Primary element: the overall bar and one bar per part, with Everything
 * else, the over-allocation warning and the "Trip: $X this month" lines.
 * Secondary (tabs): trips with their own bars across their dates, and the
 * history (planned vs actual, history grid, track record).
 */
import { useCallback, useEffect, useState } from "react";
import { Flows, type Budgets } from "@ft/core";
import { useQuery } from "../../data/hooks.ts";
import { OPEN_ITEM_EVENT, openDrillDown, type OpenItemRequest } from "../../data/drilldown.ts";
import { Button, EmptyState, Select, Tabs } from "../../ui/components.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { BudgetBar } from "./BudgetBar.tsx";
import { BudgetEditor, type ConfigValue, type EditTarget } from "./BudgetEditor.tsx";
import { HistoryView } from "./HistoryView.tsx";
import { longDate, periodLabel, todayIso, usd } from "./format.ts";
import "./budgets.css";
import { ExplainButton } from "../shared/ExplainButton.tsx";

type Tab = "period" | "trips" | "history";
type View = Budgets.BudgetPeriodView;

const categoryLabel = (c: string) => Flows.categoryLabel(c);

export function BudgetsWindow() {
  const overview = useQuery<View[]>("budgets.overview", {});
  const config = useQuery<ConfigValue>("budgets.config", {});
  const [tab, setTab] = useState<Tab>("period");
  const [budgetId, setBudgetId] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const today = todayIso();

  const views = overview.data?.value ?? [];
  const view = views.find((v) => v.budgetId === budgetId) ?? views[0];

  // ft:open-item → focus a budget part, trip or the overall bar.
  const focusItem = useCallback(
    (itemId: string | undefined) => {
      if (!itemId) return;
      const isTrip = config.data?.value.trips.some((t) => t.id === itemId);
      setTab(isTrip ? "trips" : "period");
      setHighlight(itemId);
      requestAnimationFrame(() => document.getElementById(`budget-item-${itemId}`)?.scrollIntoView?.({ block: "nearest" }));
      window.setTimeout(() => setHighlight((h) => (h === itemId ? null : h)), 2400);
    },
    [config.data],
  );
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<OpenItemRequest>).detail;
      if (d?.area === "budgets") focusItem(d.itemId);
    };
    window.addEventListener(OPEN_ITEM_EVENT, on);
    return () => window.removeEventListener(OPEN_ITEM_EVENT, on);
  }, [focusItem]);

  const loading = !overview.data && !overview.error;
  const editor = editing && config.data && (
    <BudgetEditor target={editing} config={config.data.value} categoryLabel={categoryLabel} onClose={() => setEditing(null)} />
  );

  if (overview.error && !overview.data) {
    return (
      <div className="bg-window">
        <EmptyState icon="warning" title="Couldn't load budgets" description={overview.error.message} action={{ label: "Try again", onClick: overview.refetch }} />
      </div>
    );
  }
  if (loading) return <div className="bg-window bg-muted bg-pad">Loading budgets…</div>;
  if (!view) {
    return (
      <div className="bg-window">
        <EmptyState
          icon="budgets"
          title="No budget yet"
          description="Set one overall amount per month, then add parts inside it, like Eating out or Groceries."
          action={{ label: "Create a budget", icon: "plus", onClick: () => setEditing({ kind: "budget" }), disabled: !config.data }}
        />
        {editor}
      </div>
    );
  }

  const ptext = periodLabel(view.period);
  return (
    <div className="bg-window">
      <header className="bg-header">
        <div>
          <p className="bg-eyebrow">{view.name}</p>
          <h2 className="bg-title">{ptext}</h2>
        </div>
        <div className="bg-header__controls">
          {views.length > 1 && (
            <Select label="Budget" value={view.budgetId} onChange={(e) => setBudgetId(e.target.value)}>
              {views.map((v) => (
                <option key={v.budgetId} value={v.budgetId}>
                  {v.name}
                </option>
              ))}
            </Select>
          )}
          <ExplainButton figure={{ query: "budgets.overview", params: {}, label: `${view.name} budget · ${ptext}` }} />
          <Button size="sm" onClick={() => setEditing({ kind: "budget", budgetId: view.budgetId })}>
            Edit budget
          </Button>
        </div>
      </header>
      <Tabs
        label="Budget views"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "period", label: "This period" },
          { value: "trips", label: "Trips" },
          { value: "history", label: "How I did" },
        ]}
      />
      <div role="tabpanel" aria-labelledby={`tab-${tab}`} className="bg-panel">
        {tab === "period" && <PeriodView view={view} highlight={highlight} onEdit={setEditing} />}
        {tab === "trips" && <TripsView highlight={highlight} onEdit={setEditing} today={today} />}
        {tab === "history" && <HistoryView budgetId={view.budgetId} today={today} />}
      </div>
      {editor}
    </div>
  );
}

function PeriodView({ view, highlight, onEdit }: { view: View; highlight: string | null; onEdit: (t: EditTarget) => void }) {
  const ptext = periodLabel(view.period);
  const prefix = `${view.budgetId}.`;
  const common = { query: "budgets.overview", params: {}, figurePrefix: prefix, periodText: ptext };
  return (
    <>
      <div id={`budget-item-overall`}>
        <BudgetBar bar={view.overall} {...common} size="lg" highlighted={highlight === "overall"} />
      </div>
      {view.trips.length > 0 && (
        <ul className="bg-triplines" aria-label="Trip spending counted in the overall">
          {view.trips.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className="bg-link-number"
                onClick={() => openDrillDown({ query: "budgets.overview", params: {}, figureId: `${prefix}${t.figures.spent}`, label: `${t.name} · ${ptext}` })}
              >
                {t.name}: {usd(t.spentCents)} this {view.period.end.slice(0, 7) === view.period.start.slice(0, 7) ? "month" : "period"}
              </button>
              <span className="bg-muted"> · in the overall, not in any part</span>
            </li>
          ))}
        </ul>
      )}
      {view.partsExceedOverall && (
        <p className="bg-warning" role="status">
          <Icon name="warning" size={16} /> The parts add up to {usd(view.partsTotalCents)}, which is {usd(view.partsExcessCents)} more than the overall {usd(view.overall.plannedCents ?? 0)}.
        </p>
      )}
      <div className="bg-section-head">
        <h3 className="bg-section-title">Parts</h3>
        <Button size="sm" icon="plus" onClick={() => onEdit({ kind: "part", budgetId: view.budgetId })}>
          Add part
        </Button>
      </div>
      {view.parts.length === 0 && <p className="bg-muted">No parts yet · add one for something you want to watch, like Eating out.</p>}
      <div className="bg-bars">
        {view.parts.map((p) => (
          <div key={p.id} id={`budget-item-${p.id}`}>
            <BudgetBar
              bar={p}
              {...common}
              highlighted={highlight === p.id}
              actions={
                <Button size="sm" variant="ghost" onClick={() => onEdit({ kind: "part", budgetId: view.budgetId, partId: p.id })} aria-label={`Edit ${p.name}`}>
                  Edit
                </Button>
              }
            />
          </div>
        ))}
        <div id="budget-item-everything_else">
          <BudgetBar bar={view.everythingElse} {...common} highlighted={highlight === "everything_else"} />
        </div>
      </div>
    </>
  );
}

function TripsView({ highlight, onEdit, today }: { highlight: string | null; onEdit: (t: EditTarget) => void; today: string }) {
  const q = useQuery<Budgets.TripView[]>("budgets.trips", {});
  const trips = q.data?.value;
  if (!trips) return <p className="bg-muted">{q.error ? `Couldn't load trips: ${q.error.message}` : "Loading…"}</p>;
  return (
    <>
      <div className="bg-section-head">
        <h3 className="bg-section-title">Trips</h3>
        <Button size="sm" icon="plus" onClick={() => onEdit({ kind: "trip" })}>
          Add trip
        </Button>
      </div>
      {trips.length === 0 ? (
        <EmptyState icon="budgets" title="No trips yet" description="A trip has its own dates and total, and its spending shows as a line in each month's overall." action={{ label: "Add a trip", icon: "plus", onClick: () => onEdit({ kind: "trip" }) }} />
      ) : (
        <div className="bg-bars">
          {trips.map((t) => {
            const state = today < t.startDate ? "Upcoming" : today > t.endDate ? "Finished" : "Under way";
            return (
              <div key={t.tripId} id={`budget-item-${t.tripId}`} className="bg-trip">
                <BudgetBar
                  bar={t.bar}
                  query="budgets.trips"
                  params={{}}
                  figurePrefix={`${t.tripId}.`}
                  periodText={`${longDate(t.startDate)} – ${longDate(t.endDate)}`}
                  showPace={today >= t.startDate && today <= t.endDate}
                  highlighted={highlight === t.tripId}
                  actions={
                    <Button size="sm" variant="ghost" onClick={() => onEdit({ kind: "trip", tripId: t.tripId })} aria-label={`Edit ${t.name}`}>
                      Edit
                    </Button>
                  }
                />
                <p className="bg-trip__meta">
                  {state} · {longDate(t.startDate)} – {longDate(t.endDate)}
                  {t.byMonth.map((m) => (
                    <button
                      key={m.month}
                      type="button"
                      className="bg-link-number bg-trip__month"
                      onClick={() => openDrillDown({ query: "budgets.trips", params: {}, figureId: `${t.tripId}.month.${m.month}`, label: `Trip: ${t.name} · ${m.month}` })}
                    >
                      {periodLabel({ start: `${m.month}-01`, end: endOfMonthIso(m.month) })}: {usd(m.cents)}
                    </button>
                  ))}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function endOfMonthIso(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}
