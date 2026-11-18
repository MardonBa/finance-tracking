/**
 * The app-wide category colour map (§15 "each category keeps the same colour
 * everywhere"): built from the last 12 months of spending by broad category
 * and installed with `setCategoryColorMap`, so every window that calls
 * `categoryColor(...)` agrees. Detailed categories use their broad one's colour.
 */
import { useMemo } from "react";
import { Flows, addMonthsToMonth, monthEnd, monthOf, monthStart } from "@ft/core";
import { buildColorMap, categoryColor, categoryColorMap, setCategoryColorMap, type ColorMap } from "../ui/colorMap.ts";
import { useQuery } from "./hooks.ts";
import { todayIso } from "./dates.ts";

interface ByCategory {
  totalCents: number;
  categories: { category: string; cents: number }[];
}

export function useCategoryColors(): ColorMap {
  const today = todayIso();
  const params = { from: monthStart(addMonthsToMonth(monthOf(today), -11)), to: monthEnd(monthOf(today)), level: "primary" };
  const q = useQuery<ByCategory>("spending.byCategory", params);
  return useMemo(() => {
    if (!q.data) return categoryColorMap();
    const map = buildColorMap(q.data.value.categories.map((c) => ({ key: c.category, value: c.cents })));
    setCategoryColorMap(map);
    return map;
  }, [q.data]);
}

/** The colour of any category, detailed or broad. */
export function colorOfCategory(category: string): string {
  return categoryColor(Flows.primaryOf(category));
}
