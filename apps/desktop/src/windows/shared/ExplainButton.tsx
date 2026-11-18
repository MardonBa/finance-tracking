/**
 * "Explain" next to a window's main figure (design.md §7, §16): asks the
 * assistant about it, reading the same query the window shows. Nothing runs
 * until it's clicked (decision 006).
 */
import { Button, IconButton } from "../../ui/components.tsx";
import { explainWithAssistant, type ExplainFigure } from "../assistant/explain.ts";

export function ExplainButton({ figure, compact }: { figure: ExplainFigure; compact?: boolean }) {
  const onClick = () => explainWithAssistant(figure);
  const label = `Explain ${figure.label} with the assistant`;
  if (compact) return <IconButton icon="assistant" size="sm" label={label} onClick={onClick} />;
  return (
    <Button size="sm" variant="ghost" icon="assistant" aria-label={label} title={label} onClick={onClick}>
      Explain
    </Button>
  );
}
