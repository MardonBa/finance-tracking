/**
 * ECharts options for the Trajectory window, built from registry query
 * values. Pure functions (no React), so they're easy to test.
 */
import { color, seriesColors } from "../../ui/tokens.ts";
import { OTHER_COLOR } from "../../ui/colorMap.ts";
import { longDate, money, moneyShort, monthShort, pct, shortDate } from "../shared/format.ts";
import type { EarningRow, Grain, NetWorthChart, ProjectionResult } from "./types.ts";

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const dollars = (cents: number | null) => (cents === null ? null : cents / 100);
const axisMoney = { axisLabel: { formatter: (v: number) => moneyShort(v * 100) } };

export function seriesColor(i: number): string {
  return i < seriesColors.length ? seriesColors[i]! : OTHER_COLOR;
}

/** Keep the last point of each month (or year). Points must be sorted by date. */
export function downsample<T extends { date: string }>(points: readonly T[], grain: Grain): T[] {
  const len = grain === "month" ? 7 : 4;
  const out: T[] = [];
  for (let i = 0; i < points.length; i++) {
    const next = points[i + 1];
    if (!next || next.date.slice(0, len) !== points[i]!.date.slice(0, len)) out.push(points[i]!);
  }
  return out;
}

export function periodLabel(period: string): string {
  return period.length === 4 ? period : monthShort(period);
}

/** Contiguous index ranges where `flag(i)` holds. */
export function ranges(n: number, flag: (i: number) => boolean): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i <= n; i++) {
    const on = i < n && flag(i);
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      out.push([start, i - 1]);
      start = -1;
    }
  }
  return out;
}

// ---------------------------------------------------------------- net worth

export function netWorthView(chart: NetWorthChart, grain: Grain) {
  const keep = new Set(downsample(chart.points, grain).map((p) => p.date));
  const idx = chart.points.map((p, i) => (keep.has(p.date) ? i : -1)).filter((i) => i >= 0);
  const points = idx.map((i) => chart.points[i]!);
  const series = chart.series.map((s) => ({ ...s, points: idx.map((i) => s.points[i]!) }));
  return { points, series };
}

export function netWorthOption(chart: NetWorthChart, grain: Grain) {
  const { points, series } = netWorthView(chart, grain);
  const dates = points.map((p) => p.date);
  const labels = dates.map((d) => (grain === "year" ? d.slice(0, 4) : grain === "month" ? monthShort(d.slice(0, 7)) : shortDate(d)));
  const estimated = ranges(points.length, (i) => points[i]!.isEstimated);
  const starts = chart.historyStarts
    .filter((h) => h.startsOn && h.startsOn > (dates[0] ?? "") && h.startsOn <= (dates.at(-1) ?? ""))
    .map((h) => ({ h, i: dates.findIndex((d) => d >= h.startsOn!) }))
    .filter((x) => x.i >= 0);

  return {
    grid: { left: 8, right: 16, top: 28, bottom: 8, containLabel: true },
    legend: { type: "scroll", top: 0 },
    tooltip: {
      trigger: "axis",
      formatter: (params: Array<{ dataIndex: number }>) => {
        const p = points[params[0]?.dataIndex ?? 0];
        if (!p) return "";
        const rows = p.breakdown
          .filter((b) => b.cents !== null)
          .map((b) => `${esc(b.label)}: <b>${money(b.cents!)}</b>${b.isEstimated ? " <i>(estimated)</i>" : ""}${b.isCarriedForward ? " <i>(last known)</i>" : ""}`);
        return [`<b>${longDate(p.date)}</b>`, ...rows, `Total: <b>${money(p.totalCents)}</b>${p.incomplete ? " <i>(some accounts missing)</i>" : ""}`].join("<br/>");
      },
    },
    xAxis: { type: "category", data: labels, boundaryGap: false },
    yAxis: { type: "value", ...axisMoney },
    series: [
      ...series.map((s, i) => ({
        name: s.label,
        type: "line",
        stack: s.side === "asset" ? "assets" : "debts",
        symbol: "none",
        connectNulls: false,
        lineStyle: { width: 1, color: seriesColor(i) },
        itemStyle: { color: seriesColor(i) },
        areaStyle: { color: seriesColor(i), opacity: 0.35 },
        data: s.points.map((p) => dollars(p.cents)),
      })),
      {
        name: "Net worth",
        type: "line",
        symbol: "none",
        lineStyle: { width: 2, color: color["text-strong"] },
        itemStyle: { color: color["text-strong"] },
        data: points.map((p) => p.totalCents / 100),
        markArea: {
          silent: true,
          itemStyle: { color: color["surface-cream-deep"], opacity: 0.7 },
          label: { color: color["text-muted"], position: "insideTop" },
          data: estimated.map(([a, b]) => [{ name: "Estimated (rebuilt from transactions)", xAxis: labels[a] }, { xAxis: labels[b] }]),
        },
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: color["text-muted"], type: "dotted" },
          label: { color: color["text-muted"], formatter: (x: { name: string }) => x.name, position: "insideEndTop" },
          data: starts.map(({ h, i }) => ({ name: `${h.label}: history starts`, xAxis: labels[i] })),
        },
      },
    ],
  };
}

// ---------------------------------------------------------------- earning vs spending

export function earningOption(rows: readonly EarningRow[]) {
  return {
    grid: { left: 8, right: 8, top: 28, bottom: 8, containLabel: true },
    legend: { top: 0 },
    tooltip: {
      trigger: "axis",
      formatter: (params: Array<{ dataIndex: number }>) => {
        const r = rows[params[0]?.dataIndex ?? 0];
        if (!r) return "";
        return [
          `<b>${periodLabel(r.period)}</b>`,
          `Income: <b>${money(r.incomeCents)}</b>`,
          `Spending: <b>${money(r.spendingCents)}</b>`,
          `Saved: <b>${money(r.savedCents)}</b>`,
          `Savings rate: <b>${pct(r.savingsRate)}</b>`,
          `Spending share of income: <b>${pct(r.spendingShare)}</b>`,
        ].join("<br/>");
      },
    },
    xAxis: { type: "category", data: rows.map((r) => periodLabel(r.period)) },
    yAxis: [
      { type: "value", ...axisMoney },
      { type: "value", axisLabel: { formatter: (v: number) => `${v}%` }, splitLine: { show: false } },
    ],
    series: [
      { name: "Income", type: "bar", stack: "flow", data: rows.map((r) => r.incomeCents / 100), itemStyle: { color: color["accent-blue"] }, cursor: "pointer" },
      { name: "Spending", type: "bar", stack: "flow", data: rows.map((r) => -r.spendingCents / 100), itemStyle: { color: color["orange-600"], borderRadius: [0, 0, 4, 4] }, cursor: "pointer" },
      {
        name: "Savings rate",
        type: "line",
        yAxisIndex: 1,
        data: rows.map((r) => (r.savingsRate === null ? null : Math.round(r.savingsRate * 1000) / 10)),
        lineStyle: { color: color["pink-600"] },
        itemStyle: { color: color["pink-600"] },
      },
    ],
  };
}

// ---------------------------------------------------------------- projection

export const PART_LABELS = { cash: "Cash", hysa: "HYSA", investments: "Investments", debts: "Debts" } as const;

export function projectionOption(p: ProjectionResult) {
  const labels = p.points.map((pt) => (p.horizonYears === 1 ? shortDate(pt.date) : String(pt.year)));
  const assumed = ranges(p.points.length, (i) => p.points[i]!.basisKind === "assumed_same");
  const parts = (["investments", "hysa", "cash", "debts"] as const).map((k, i) => ({
    name: PART_LABELS[k],
    type: "line",
    symbol: "none",
    lineStyle: { width: 1, color: seriesColor(i + 1), type: "dashed" },
    itemStyle: { color: seriesColor(i + 1) },
    data: p.points.map((pt) => pt.parts[k] / 100),
  }));
  return {
    grid: { left: 8, right: 16, top: 28, bottom: 8, containLabel: true },
    legend: { top: 0, data: ["Expected net worth", "Range", ...parts.map((x) => x.name)] },
    tooltip: {
      trigger: "axis",
      formatter: (params: Array<{ dataIndex: number }>) => {
        const pt = p.points[params[0]?.dataIndex ?? 0];
        if (!pt) return "";
        return [
          `<b>${p.horizonYears === 1 ? longDate(pt.date) : pt.year}</b> · ${esc(pt.basisLabel)}`,
          `Expected: <b>${money(pt.totalCents)}</b>`,
          `Range: ${money(pt.lowCents)} – ${money(pt.highCents)}`,
          ...(["cash", "hysa", "investments", "debts"] as const).map((k) => `${PART_LABELS[k]}: ${money(pt.parts[k])}`),
        ].join("<br/>");
      },
    },
    xAxis: { type: "category", data: labels, boundaryGap: false },
    yAxis: { type: "value", ...axisMoney },
    series: [
      // The band: an invisible lower line, then (high − low) stacked on top of it.
      { name: "Range low", type: "line", stack: "band", symbol: "none", lineStyle: { opacity: 0 }, data: p.points.map((pt) => pt.lowCents / 100), tooltip: { show: false } },
      {
        name: "Range",
        type: "line",
        stack: "band",
        symbol: "none",
        lineStyle: { opacity: 0 },
        itemStyle: { color: color["accent-blue-soft"] },
        areaStyle: { color: color["accent-blue-soft"], opacity: 0.9 },
        data: p.points.map((pt) => (pt.highCents - pt.lowCents) / 100),
      },
      {
        name: "Expected net worth",
        type: "line",
        symbol: "none",
        lineStyle: { width: 2, color: color["accent-blue"] },
        itemStyle: { color: color["accent-blue"] },
        data: p.points.map((pt) => pt.totalCents / 100),
        markArea: {
          silent: true,
          itemStyle: { color: color["orange-100"], opacity: 0.45 },
          label: { color: color["orange-700"], position: "insideTop" },
          data: assumed.map(([a, b]) => [{ name: "Assumed to stay the same", xAxis: labels[a] }, { xAxis: labels[b] }]),
        },
      },
      ...parts,
    ],
  };
}

/** Consecutive years with the same basis, e.g. "2027–2030: Early career". */
export function basisRanges(years: ProjectionResult["years"]): Array<{ from: number; to: number; kind: string; label: string }> {
  const out: Array<{ from: number; to: number; kind: string; label: string }> = [];
  for (const y of years) {
    const last = out.at(-1);
    if (last && last.label === y.label && last.kind === y.kind && last.to === y.year - 1) last.to = y.year;
    else out.push({ from: y.year, to: y.year, kind: y.kind, label: y.label });
  }
  return out;
}
