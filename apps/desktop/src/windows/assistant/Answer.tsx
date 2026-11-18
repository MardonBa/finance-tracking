/**
 * Renders an assistant answer: light formatting (paragraphs, "- " lists,
 * **bold**) and citation tags. "[F12]" becomes a link to the transactions
 * behind that figure (openDrillDown with the cited query, params and figure
 * id); "[C3]" opens the chart's window.
 */
import type { ReactNode } from "react";
import { openDrillDown } from "../../data/drilldown.ts";
import type { AreaId } from "../../shell/areas.ts";
import type { Citation } from "./api.ts";

const TAG = /\[([FC]\d+(?:\s*,\s*[FC]\d+)*)\]/g;

/** Which window shows a query's chart. */
export function areaForQuery(query: string): AreaId {
  const module = query.split(".")[0];
  switch (module) {
    case "spending":
    case "budgets":
    case "goals":
    case "recurring":
    case "trajectory":
    case "investments":
    case "transactions":
      return module;
    case "flows":
      return "transactions";
    default:
      return "overview";
  }
}

function bold(text: string, key: string): ReactNode[] {
  return text.split(/\*\*(.+?)\*\*/g).map((s, i) => (i % 2 === 1 ? <strong key={`${key}b${i}`}>{s}</strong> : s));
}

function inline(text: string, citations: Record<string, Citation>, openArea: (a: AreaId) => void, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(TAG)) {
    out.push(...bold(text.slice(last, m.index), `${key}t${n}`));
    for (const tag of m[1]!.split(/\s*,\s*/)) {
      const c = citations[tag];
      const k = `${key}c${n++}`;
      if (!c) continue; // an unknown tag is dropped rather than shown as noise
      if (c.kind === "figure") {
        const label = c.label ?? `${c.query} · ${c.figureId}`;
        out.push(
          <button
            key={k}
            type="button"
            className="as-cite"
            aria-label={`Show transactions: ${label}`}
            title={label}
            onClick={() => openDrillDown({ query: c.query, params: c.params, figureId: c.figureId, label })}
          >
            ↗
          </button>,
        );
      } else {
        const area = areaForQuery(c.query);
        out.push(
          <button key={k} type="button" className="as-cite as-cite--chart" aria-label={`Open the chart (${c.query})`} title={c.query} onClick={() => openArea(area)}>
            chart
          </button>,
        );
      }
    }
    last = m.index + m[0].length;
  }
  out.push(...bold(text.slice(last), `${key}end`));
  return out;
}

export function Answer({ text, citations, openArea }: { text: string; citations: Record<string, Citation>; openArea: (a: AreaId) => void }) {
  const blocks: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = (i: number) => {
    if (list.length) blocks.push(<ul key={`ul${i}`}>{list}</ul>);
    list = [];
  };
  text.split("\n").forEach((raw, i) => {
    const line = raw.trimEnd();
    const item = /^\s*(?:[-*•]|\d+\.)\s+(.*)$/.exec(line);
    if (item) {
      list.push(<li key={`li${i}`}>{inline(item[1]!, citations, openArea, `l${i}`)}</li>);
      return;
    }
    flush(i);
    if (line.trim()) blocks.push(<p key={`p${i}`}>{inline(line.replace(/^#+\s*/, ""), citations, openArea, `p${i}`)}</p>);
  });
  flush(-1);
  return <div className="as-answer">{blocks}</div>;
}
