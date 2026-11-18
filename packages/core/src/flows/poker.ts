/**
 * Poker banking (§6). Individual Poker transactions are neither spending nor
 * income; the net per period (money in − money out) is one income line,
 * negative when it was a losing period.
 */
import type { IsoDate } from "../dates.ts";
import type { Figure } from "../registry.ts";
import { figure, inPeriod, measures } from "./figures.ts";
import type { Ledger } from "./ledger.ts";

export interface PokerSummary {
  from: IsoDate;
  to: IsoDate;
  inCents: number;
  outCents: number;
  /** In − out; added to income as one "Poker" line. */
  netCents: number;
  count: number;
}

export function pokerSummary(
  ledger: Ledger,
  from: IsoDate,
  to: IsoDate,
): { value: PokerSummary; figures: { in: Figure; out: Figure; net: Figure } } {
  const poker = inPeriod(ledger.entries, from, to).filter((e) => e.bucket === "poker");
  const inFig = figure(poker, measures.inflow, `Poker money in · ${from} – ${to}`);
  const outFig = figure(poker, measures.outflow, `Poker money out · ${from} – ${to}`);
  const net = figure(poker, measures.amount, `Poker net · ${from} – ${to}`);
  return {
    value: { from, to, inCents: inFig.cents, outCents: outFig.cents, netCents: net.cents, count: poker.length },
    figures: { in: inFig, out: outFig, net },
  };
}
