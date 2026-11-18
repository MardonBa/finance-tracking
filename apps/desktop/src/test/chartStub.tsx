/**
 * Stand-in for ui/Chart.tsx in jsdom tests (no canvas): renders the
 * accessible label and records each option so tests can inspect series,
 * markers and click handlers.
 *
 *   vi.mock("../../ui/Chart.tsx", () => import("../../test/chartStub.tsx"));
 */
import type { ChartProps } from "../ui/Chart.tsx";

export const rendered: ChartProps[] = [];

export function Chart(props: ChartProps) {
  rendered.push(props);
  return <div role="img" aria-label={props.ariaLabel} data-testid="chart" />;
}

/** The most recent props of the chart whose label matches. */
export function lastChart(label: RegExp): ChartProps | undefined {
  return [...rendered].reverse().find((c) => label.test(c.ariaLabel));
}

export const echarts = {};
