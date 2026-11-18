/**
 * Every figure, bar, segment and cell drills down (§7, §15): the Transactions
 * window re-runs this exact query + params and shows the figure's transactions.
 */
import type { Figure } from "@ft/core";
import { useQuery } from "../../data/hooks.ts";
import { openDrillDown } from "../../data/drilldown.ts";

export type Figures = Record<string, Figure>;

/** A drill function bound to one query run; returns undefined when the figure doesn't exist (nothing to show). */
export function drillFor(query: string, params: unknown, figures: Figures | undefined) {
  return (figureId: string): (() => void) | undefined => {
    const f = figures?.[figureId];
    if (!f) return undefined;
    return () => openDrillDown({ query, params, figureId, label: f.label ?? figureId });
  };
}

/** useQuery plus its bound drill function. */
export function useFigures<V>(query: string, params: unknown) {
  const q = useQuery<V>(query, params);
  return { ...q, value: q.data?.value, figures: q.data?.figures, drill: drillFor(query, params, q.data?.figures) };
}
