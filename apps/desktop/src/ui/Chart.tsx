/**
 * Thin ECharts wrapper with the app theme. Tree-shaken: only the chart types
 * below are bundled. A Phase 2 window that needs another type calls
 * `echarts.use([...])` from its own file (import { echarts } from "../ui/Chart").
 */
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { BarChart, HeatmapChart, LineChart, PieChart, SankeyChart } from "echarts/charts";
import {
  CalendarComponent,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { CSSProperties } from "react";
import { CHART_THEME, chartTheme } from "./chartTheme.ts";

echarts.use([
  BarChart,
  HeatmapChart,
  LineChart,
  PieChart,
  SankeyChart,
  CalendarComponent,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);
echarts.registerTheme(CHART_THEME, chartTheme as object);

export { echarts };

export interface ChartProps {
  option: Record<string, unknown>;
  style?: CSSProperties;
  /** Accessible summary of what the chart shows. */
  ariaLabel: string;
  onEvents?: Record<string, (params: unknown) => void>;
}

export function Chart({ option, style, ariaLabel, onEvents }: ChartProps) {
  return (
    <div role="img" aria-label={ariaLabel} style={{ width: "100%", height: "100%", ...style }}>
      <ReactEChartsCore
        echarts={echarts}
        option={option}
        theme={CHART_THEME}
        notMerge
        lazyUpdate
        style={{ width: "100%", height: "100%" }}
        onEvents={onEvents}
        opts={{ renderer: "canvas" }}
      />
    </div>
  );
}
