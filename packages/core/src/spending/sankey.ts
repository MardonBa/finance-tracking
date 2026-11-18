/**
 * Flow diagram data (§8, design.md §3): income sources → "Income" →
 * categories → top merchants per category (the rest as "Other"), and what is
 * left flows to "Saved" (or "Overspent" flows in when spending > income).
 * Every link value is a figure, so clicking a branch drills down exactly.
 */
import type { Cents } from "../money.ts";
import type { IsoDate } from "../dates.ts";
import type { Contribution, Figure } from "../registry.ts";
import { categoryLabel } from "../flows/categories.ts";
import { figure, groupBy, inPeriod, measures } from "../flows/figures.ts";
import type { Ledger, LedgerEntry } from "../flows/ledger.ts";

export interface SankeyNode {
  id: string;
  label: string;
  kind: "source" | "hub" | "category" | "merchant" | "saved" | "overspent";
}

export interface SankeyLink {
  source: string;
  target: string;
  cents: Cents;
  /** Key into `figures`. */
  figure: string;
}

export interface Sankey {
  nodes: SankeyNode[];
  links: SankeyLink[];
  incomeCents: Cents;
  spendingCents: Cents;
  /** Positive = saved, negative = overspent. */
  leftoverCents: Cents;
}

export interface SankeyOptions {
  /** Income sources shown before grouping into "Other income". */
  maxSources?: number;
  /** Merchants shown per category before "Other". */
  merchantsPerCategory?: number;
}

const negate = (f: Figure, label?: string): Figure => ({
  cents: -f.cents || 0,
  contributions: f.contributions.map((c) => ({ ...c, cents: -c.cents || 0 })),
  ...(label !== undefined ? { label } : f.label !== undefined ? { label: f.label } : {}),
});

const merge = (figs: readonly Figure[], label: string): Figure => {
  const contributions: Contribution[] = figs.flatMap((f) => f.contributions);
  return { cents: contributions.reduce((s, c) => s + c.cents, 0), contributions, label };
};

const byCentsDesc = <T extends { fig: Figure; label: string }>(a: T, b: T) =>
  b.fig.cents - a.fig.cents || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);

export function sankey(ledger: Ledger, from: IsoDate, to: IsoDate, opts: SankeyOptions = {}): { value: Sankey; figures: Record<string, Figure> } {
  const maxSources = opts.maxSources ?? 5;
  const perCat = opts.merchantsPerCategory ?? 3;
  const period = `${from} – ${to}`;
  const entries = inPeriod(ledger.entries, from, to);
  const nodes: SankeyNode[] = [{ id: "hub", label: "Income", kind: "hub" }];
  const links: SankeyLink[] = [];
  const figures: Record<string, Figure> = {};
  const add = (key: string, fig: Figure, source: string, target: string) => {
    figures[key] = fig;
    links.push({ source, target, cents: fig.cents, figure: key });
  };

  // Left side (into the hub) and right side (out of the hub), before balancing.
  type Side = { id: string; label: string; kind: SankeyNode["kind"]; fig: Figure; entries: LedgerEntry[] };
  const left: Side[] = [];
  const right: Side[] = [];

  // Income sources by payer; Poker net as one source.
  const income = entries.filter((e) => e.bucket === "income");
  const sources = [...groupBy(income, (e) => e.merchantKey).entries()].map(([key, es]) => ({
    key,
    label: es[0]!.merchantName,
    fig: figure(es, measures.income, `Income from ${es[0]!.merchantName} · ${period}`),
    entries: es,
  }));
  sources.sort(byCentsDesc);
  const shown = sources.filter((s) => s.fig.cents > 0).slice(0, maxSources);
  const rest = sources.filter((s) => !shown.includes(s));
  for (const s of shown) left.push({ id: `src:${s.key}`, label: s.label, kind: "source", fig: s.fig, entries: s.entries });
  if (rest.length > 0) {
    const es = rest.flatMap((s) => s.entries);
    left.push({ id: "src:other", label: "Other income", kind: "source", fig: figure(es, measures.income, `Other income · ${period}`), entries: es });
  }
  const poker = entries.filter((e) => e.bucket === "poker");
  if (poker.length > 0) {
    left.push({ id: "src:poker", label: "Poker", kind: "source", fig: figure(poker, measures.amount, `Poker net · ${period}`), entries: poker });
  }

  // Spending by broad category.
  const spending = entries.filter((e) => e.bucket === "spending");
  const cats = [...groupBy(spending, (e) => e.categoryPrimary).entries()].map(([cat, es]) => ({
    cat,
    label: categoryLabel(cat),
    fig: figure(es, measures.spend, `${categoryLabel(cat)} · ${period}`),
    entries: es,
  }));
  cats.sort(byCentsDesc);
  for (const c of cats) right.push({ id: `cat:${c.cat}`, label: c.label, kind: "category", fig: c.fig, entries: c.entries });

  // Negative flows switch sides (a losing Poker month is money out; a category
  // with more refunds than purchases is money in).
  const finalLeft: Side[] = [];
  const finalRight: Side[] = [];
  for (const s of left) {
    if (s.fig.cents > 0) finalLeft.push(s);
    else if (s.fig.cents < 0) finalRight.push({ ...s, label: `${s.label} (net loss)`, fig: negate(s.fig) });
  }
  for (const s of right) {
    if (s.fig.cents > 0) finalRight.push(s);
    else if (s.fig.cents < 0) finalLeft.push({ ...s, kind: "source", label: `${s.label} (refunds)`, fig: negate(s.fig) });
  }

  const inFig = merge(finalLeft.map((s) => s.fig), `Money in · ${period}`);
  const outFig = merge(finalRight.map((s) => s.fig), `Money out · ${period}`);
  const leftover = inFig.cents - outFig.cents;

  for (const s of finalLeft) {
    nodes.push({ id: s.id, label: s.label, kind: s.kind === "category" ? "source" : s.kind });
    add(`in.${s.id}`, s.fig, s.id, "hub");
  }
  for (const s of finalRight) {
    nodes.push({ id: s.id, label: s.label, kind: s.kind });
    add(`out.${s.id}`, s.fig, "hub", s.id);
    if (s.kind !== "category") continue;
    // Top merchants of this category, then "Other".
    const ms = [...groupBy(s.entries, (e) => e.merchantKey).entries()].map(([key, es]) => ({
      key,
      label: es[0]!.merchantName,
      fig: figure(es, measures.spend, `${s.label} · ${es[0]!.merchantName} · ${period}`),
      entries: es,
    }));
    ms.sort(byCentsDesc);
    let top = ms.filter((m) => m.fig.cents > 0).slice(0, perCat);
    const otherOf = (t: typeof top) => {
      const es = ms.filter((m) => !t.includes(m)).flatMap((m) => m.entries);
      return figure(es, measures.spend, `${s.label} · other merchants · ${period}`);
    };
    let other = otherOf(top);
    while (other.cents < 0 && top.length > 0) {
      top = top.slice(0, -1);
      other = otherOf(top);
    }
    for (const m of top) {
      const id = `mer:${s.id.slice(4)}:${m.key}`;
      nodes.push({ id, label: m.label, kind: "merchant" });
      add(`out.${id}`, m.fig, s.id, id);
    }
    if (other.cents > 0) {
      const id = `mer:${s.id.slice(4)}:other`;
      nodes.push({ id, label: "Other", kind: "merchant" });
      add(`out.${id}`, other, s.id, id);
    }
  }

  // Leftover: saved = in − out, with every contribution kept (out ones negated).
  const savedFig: Figure = merge([inFig, negate(outFig)], leftover >= 0 ? `Saved · ${period}` : `Overspent · ${period}`);
  if (leftover > 0) {
    nodes.push({ id: "saved", label: "Saved", kind: "saved" });
    add("saved", savedFig, "hub", "saved");
  } else if (leftover < 0) {
    nodes.push({ id: "overspent", label: "Overspent", kind: "overspent" });
    add("overspent", negate(savedFig, `Overspent · ${period}`), "overspent", "hub");
  }
  figures.income = figure(entries, measures.incomeWithPoker, `Income · ${period}`);
  figures.spending = figure(entries, measures.spend, `Spending · ${period}`);
  return {
    value: { nodes, links, incomeCents: figures.income.cents, spendingCents: figures.spending.cents, leftoverCents: leftover },
    figures,
  };
}
