/**
 * One budget bar (design.md §4): spent vs expected with a pace marker for
 * today, the end-of-period projection, and pending charges as a faded
 * extension that isn't counted (decision 005). The spent and pending parts
 * each drill down to their transactions.
 */
import type { Budgets } from "@ft/core";
import { StatusLabel, type Status } from "../../ui/components.tsx";
import { openDrillDown } from "../../data/drilldown.ts";
import { usd } from "./format.ts";

export type Bar = Budgets.BudgetBar;

const STATUS: Record<Bar["status"], { status: Status; text: string } | null> = {
  on_pace: { status: "on-track", text: "On pace" },
  ahead_of_pace: { status: "warning", text: "Ahead of pace" },
  over: { status: "over", text: "Over" },
  under: { status: "under", text: "Under" },
  no_plan: null,
};

export function barStatus(b: Pick<Bar, "status">) {
  return STATUS[b.status];
}

export interface BudgetBarProps {
  bar: Bar;
  /** Query that produced the bar, for the drill-down. */
  query: string;
  params: unknown;
  /** Prefix added to the bar's figure keys (e.g. "<budgetId>."). */
  figurePrefix?: string;
  /** Period words for drill-down labels, e.g. "October 2026". */
  periodText: string;
  size?: "lg" | "md";
  /** Hide pace/projection (finished periods, trip lines). */
  showPace?: boolean;
  /** Extra controls on the right of the title (e.g. Edit). */
  actions?: React.ReactNode;
  highlighted?: boolean;
  id?: string;
}

const pct = (v: number, scale: number) => `${Math.max(0, Math.min(100, (v / scale) * 100))}%`;

export function BudgetBar({ bar, query, params, figurePrefix = "", periodText, size = "md", showPace = true, actions, highlighted, id }: BudgetBarProps) {
  const planned = bar.plannedCents;
  const scale = Math.max(planned ?? 0, bar.spentCents + bar.pendingCents, showPace ? bar.projectedCents : 0, 1);
  const st = barStatus(bar);
  const drill = (which: "spent" | "pending") =>
    openDrillDown({
      query,
      params,
      figureId: `${figurePrefix}${bar.figures[which]}`,
      label: `${bar.name} · ${which === "pending" ? "pending · " : ""}${periodText}`,
    });
  const over = planned !== null && bar.projectedCents > planned ? bar.projectedCents - planned : 0;
  const projection =
    planned === null
      ? null
      : over > 0
        ? `At this rate: ${usd(over)} over`
        : `On track for ${usd(bar.projectedCents)}`;
  return (
    <div className={`bg-bar bg-bar--${size} bg-bar--${bar.status}${highlighted ? " is-highlighted" : ""}`} id={id} data-testid={`bar-${bar.id}`}>
      <div className="bg-bar__head">
        <span className="bg-bar__name">{bar.name}</span>
        <button type="button" className="bg-bar__figure" onClick={() => drill("spent")} aria-label={`${bar.name}: ${usd(bar.spentCents)} spent. Show transactions`}>
          <span className="bg-bar__spent">{usd(bar.spentCents)}</span>
          {planned !== null && <span className="bg-bar__of"> of {usd(planned)}</span>}
        </button>
        {st && <StatusLabel status={st.status}>{st.text}</StatusLabel>}
        {actions && <span className="bg-bar__actions">{actions}</span>}
      </div>
      <div className="bg-bar__track">
        {planned !== null && <span className="bg-bar__plan" style={{ width: pct(planned, scale) }} aria-hidden="true" />}
        {showPace && planned !== null && bar.projectedCents > bar.spentCents && (
          <span
            className="bg-bar__projection"
            style={{ left: pct(bar.spentCents + bar.pendingCents, scale), width: pct(Math.max(0, bar.projectedCents - bar.spentCents - bar.pendingCents), scale) }}
            aria-hidden="true"
          />
        )}
        <button
          type="button"
          className="bg-bar__fill"
          style={{ width: pct(bar.spentCents, scale) }}
          onClick={() => drill("spent")}
          aria-label={`${bar.name}: spent ${usd(bar.spentCents)}. Show transactions`}
          tabIndex={-1}
        />
        {bar.pendingCents > 0 && (
          <button
            type="button"
            className="bg-bar__pending"
            style={{ left: pct(bar.spentCents, scale), width: pct(bar.pendingCents, scale) }}
            onClick={() => drill("pending")}
            aria-label={`${bar.name}: ${usd(bar.pendingCents)} pending, not counted. Show transactions`}
          />
        )}
        {showPace && bar.paceCents !== null && (
          <span className="bg-bar__pace" style={{ left: pct(bar.paceCents, scale) }} aria-hidden="true">
            <span className="bg-bar__pace-tick" />
          </span>
        )}
      </div>
      <div className="bg-bar__foot">
        {showPace && bar.paceCents !== null && <span>▲ Pace {usd(bar.paceCents)} by today</span>}
        {showPace && projection && <span>{projection}</span>}
        {bar.remainingCents !== null && bar.remainingCents >= 0 && <span>{usd(bar.remainingCents)} left</span>}
        {bar.pendingCents > 0 && <span className="bg-bar__pending-note">+{usd(bar.pendingCents)} pending (not counted)</span>}
      </div>
    </div>
  );
}
