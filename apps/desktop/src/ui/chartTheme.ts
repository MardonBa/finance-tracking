/**
 * ECharts theme built from the design tokens (§15). Registered once as
 * `CHART_THEME` by ui/Chart.tsx. Pure data so it can be unit-tested.
 */
import { color, fontSans, seriesColors } from "./tokens.ts";

export const CHART_THEME = "finance-tracker";

const axisCommon = {
  axisLine: { show: true, lineStyle: { color: color["text-muted"], width: 1 } },
  axisTick: { show: false },
  axisLabel: { color: color["text-muted"], fontSize: 12 },
  splitLine: { show: true, lineStyle: { color: color["border-soft"], type: "dashed" as const } },
  splitArea: { show: false },
};

export const chartTheme = {
  color: [...seriesColors],
  backgroundColor: "transparent",
  textStyle: { fontFamily: fontSans, color: color.text, fontSize: 12 },
  title: {
    textStyle: { color: color["text-strong"], fontSize: 16, fontWeight: 600 },
    subtextStyle: { color: color["text-muted"], fontSize: 12 },
  },
  legend: {
    textStyle: { color: color.text, fontSize: 12 },
    icon: "roundRect",
    itemWidth: 12,
    itemHeight: 12,
  },
  tooltip: {
    backgroundColor: color["surface-white"],
    borderColor: color.border,
    borderWidth: 2,
    padding: [8, 12],
    textStyle: { color: color["text-strong"], fontSize: 12 },
    extraCssText: `box-shadow: 3px 3px 0 0 ${color.border}; border-radius: 8px;`,
    axisPointer: { lineStyle: { color: color["text-muted"] }, crossStyle: { color: color["text-muted"] } },
  },
  grid: { left: 48, right: 16, top: 24, bottom: 32, containLabel: true },
  categoryAxis: { ...axisCommon, splitLine: { show: false } },
  valueAxis: { ...axisCommon, axisLine: { show: false } },
  timeAxis: { ...axisCommon, splitLine: { show: false } },
  line: { symbol: "circle", symbolSize: 6, smooth: false, lineStyle: { width: 2 } },
  bar: { itemStyle: { borderRadius: [4, 4, 0, 0] }, barMaxWidth: 32 },
  pie: { itemStyle: { borderColor: color["surface-white"], borderWidth: 2 } },
  sankey: { lineStyle: { color: "gradient", opacity: 0.35 }, label: { color: color.text } },
  heatmap: { itemStyle: { borderColor: color["surface-white"], borderWidth: 2 } },
  visualMap: { inRange: { color: [color["orange-100"], color["orange-600"]] }, textStyle: { color: color.text } },
  markLine: { lineStyle: { color: color["accent-blue"], type: "dashed" } },
  emphasis: { focus: "series" },
} as const;
