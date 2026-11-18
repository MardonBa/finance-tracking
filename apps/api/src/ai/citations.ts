/** Citation helpers for assistant answers (§16 "each figure in an answer links to the chart or transactions behind it"). */

/** The parts of a harness citation this needs (structural, so this file doesn't import the harness). */
type Tagged = { kind: "figure"; query: string; params: unknown; figureId: string; cents: number } | { kind: "chart" };

/**
 * Dollar amounts the model wrote without a tag (often month-by-month trend
 * amounts) get the figure link anyway when exactly one figure seen this turn
 * has that amount: same cents (sign ignored), one query + params + figure.
 * Ambiguous or unknown amounts stay unlinked rather than risk a wrong link.
 */
export function linkUntaggedAmounts(text: string, tags: ReadonlyMap<string, Tagged>): string {
  const byCents = new Map<number, Map<string, string>>();
  for (const [tag, c] of tags) {
    if (c.kind !== "figure") continue;
    const key = JSON.stringify([c.query, c.params, c.figureId]);
    const cents = Math.abs(c.cents);
    if (!byCents.has(cents)) byCents.set(cents, new Map());
    const same = byCents.get(cents)!;
    if (!same.has(key)) same.set(key, tag);
  }
  // "$1,234.56" or "$1,234" not already followed by a tag like " [F3]" or "[F3, F4]".
  return text.replace(/-?\$\d(?:[\d,]*\d)?(?:\.\d{2})?(?![\d.,]\d)(?![\d])(?!\s*\[[FC]\d)/g, (amount) => {
    const cents = Math.round(Number(amount.replace(/[-$,]/g, "")) * 100);
    const found = byCents.get(cents);
    if (!found || found.size !== 1) return amount;
    return `${amount} [${[...found.values()][0]}]`;
  });
}
