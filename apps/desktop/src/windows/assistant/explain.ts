/**
 * "Explain this" (design.md §7): any window can ask the assistant about one of
 * its figures. Opens (or focuses) the assistant window and asks; the
 * assistant then reads the same query the chart used. Nothing runs until the
 * user clicks (decision 006).
 *
 *   <Button onClick={() => explainWithAssistant({ query, params, figureId, label })}>Explain</Button>
 */
import { openItem } from "../../data/drilldown.ts";

export const EXPLAIN_EVENT = "ft:assistant-explain";

export interface ExplainFigure {
  query: string;
  params: unknown;
  figureId?: string;
  /** What the user sees, e.g. "Spending · November". */
  label: string;
}

let pending: ExplainFigure | null = null;

export function explainWithAssistant(req: ExplainFigure): void {
  pending = req;
  openItem({ area: "assistant" });
  window.dispatchEvent(new CustomEvent<ExplainFigure>(EXPLAIN_EVENT, { detail: req }));
}

/** For the assistant window when it mounts after the click opened it. */
export function takePendingExplain(): ExplainFigure | null {
  const r = pending;
  pending = null;
  return r;
}
