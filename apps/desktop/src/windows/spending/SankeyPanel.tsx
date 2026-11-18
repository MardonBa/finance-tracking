/**
 * The month in one picture (§8, design.md §3): income sources → Income →
 * categories → top merchants, with the leftover flowing to Saved (or
 * Overspent flowing in). Every link and node drills down to its figure.
 */
import type { Spending } from "@ft/core";
import { Chart } from "../../ui/Chart.tsx";
import { categoryColor } from "../../ui/colorMap.ts";
import { color } from "../../ui/tokens.ts";
import { money } from "../transactions/format.ts";
import { useFigures } from "./drill.ts";
import { ConnectEmptyState } from "../shared/ConnectEmptyState.tsx";

type Sankey = Spending.Sankey;

export const SANKEY_DEFAULTS = { maxSources: 5, merchantsPerCategory: 3 };

function nodeColor(n: Spending.SankeyNode): string {
  switch (n.kind) {
    case "category":
      return categoryColor(n.id.slice(4));
    case "merchant":
      return categoryColor(n.id.split(":")[1] ?? "");
    case "saved":
      return color["status-ok"];
    case "overspent":
      return color["status-danger"];
    case "hub":
      return color["blue-500"];
    default:
      return color["accent-blue"];
  }
}

/** The figure a click on a node stands for: the link into it (or out of a source). */
export function nodeFigure(v: Sankey, nodeId: string): string | null {
  if (nodeId === "hub") return "income";
  const into = v.links.find((l) => l.target === nodeId);
  if (into && nodeId !== "hub") return into.figure;
  const out = v.links.find((l) => l.source === nodeId);
  return out ? out.figure : null;
}

/** Map an ECharts click to a figure key. */
export function sankeyClickFigure(v: Sankey, params: { dataType?: string; data?: { figure?: string; name?: string } }): string | null {
  if (params.dataType === "edge") return params.data?.figure ?? null;
  if (params.dataType === "node" && params.data?.name) return nodeFigure(v, params.data.name);
  return null;
}

export function sankeyOption(v: Sankey): Record<string, unknown> {
  const labels = new Map(v.nodes.map((n) => [n.id, n.label]));
  return {
    tooltip: {
      trigger: "item",
      formatter: (p: { dataType: string; data: { source?: string; target?: string; name?: string; cents?: number } }) =>
        p.dataType === "edge"
          ? `${labels.get(p.data.source!)} → ${labels.get(p.data.target!)}: ${money(p.data.cents ?? 0)}`
          : `${labels.get(p.data.name!) ?? p.data.name}`,
    },
    series: [
      {
        type: "sankey",
        left: 8,
        right: 120,
        top: 8,
        bottom: 8,
        nodeGap: 6,
        nodeWidth: 12,
        draggable: false,
        layoutIterations: 32,
        emphasis: { focus: "adjacency" },
        label: { formatter: (p: { name: string }) => labels.get(p.name) ?? p.name, fontSize: 11, color: color["text-strong"] },
        lineStyle: { color: "target", opacity: 0.3, curveness: 0.5 },
        data: v.nodes.map((n) => ({ name: n.id, itemStyle: { color: nodeColor(n), borderColor: color.border, borderWidth: 1 } })),
        links: v.links.map((l) => ({ source: l.source, target: l.target, value: l.cents / 100, cents: l.cents, figure: l.figure })),
      },
    ],
  };
}

export function SankeyPanel({ month }: { month: string }) {
  const params = { month, ...SANKEY_DEFAULTS };
  const q = useFigures<Sankey>("spending.sankey", params);
  const v = q.value;
  if (!v) return <p className="tx-muted">Loading…</p>;
  if (v.links.length === 0)
    return <ConnectEmptyState icon="spending" title="Nothing came in or went out this month" description="Pick an earlier month, or connect a bank to see where your money goes." />;
  const onClick = (p: unknown) => {
    const fig = sankeyClickFigure(v, p as Parameters<typeof sankeyClickFigure>[1]);
    if (fig) q.drill(fig)?.();
  };
  const merchants = v.nodes.filter((n) => n.kind === "merchant").length;
  return (
    <div className="sp-sankey">
      <Chart
        option={sankeyOption(v)}
        ariaLabel={`Flow for ${month}: ${money(v.incomeCents)} in, ${money(v.spendingCents)} spent, ${v.leftoverCents >= 0 ? `${money(v.leftoverCents)} saved` : `${money(-v.leftoverCents)} overspent`}. Click any flow to see its transactions.`}
        style={{ height: "100%", minHeight: Math.max(220, Math.min(420, 18 * merchants)) }}
        onEvents={{ click: onClick }}
      />
      {/* Keyboard / screen-reader path to the same figures. */}
      <details className="sp-sankey__list">
        <summary>List the flows</summary>
        <ul>
          {v.links.map((l) => (
            <li key={l.figure}>
              <button type="button" className="tx-link" onClick={q.drill(l.figure)}>
                {v.nodes.find((n) => n.id === l.source)?.label} → {v.nodes.find((n) => n.id === l.target)?.label}: {money(l.cents)}
              </button>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
