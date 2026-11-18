/**
 * Month calendar (§9, design.md §3 "Recurring charges across a month"): when
 * each charge hits, with the month's total of fixed costs in the header.
 */
import { addMonthsToMonth, daysInMonth, type IsoMonth } from "@ft/core";
import { useQuery } from "../../data/hooks.ts";
import { Button, Card, EmptyState, StatNumber } from "../../ui/components.tsx";
import { money, monthName } from "../shared/format.ts";
import type { MonthCalendar } from "./types.ts";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function CalendarTab({ month, setMonth }: { month: IsoMonth; setMonth: (m: IsoMonth) => void }) {
  const q = useQuery<MonthCalendar>("recurring.calendar", { month });
  const cal = q.data?.value;
  const [y, m] = month.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const nDays = daysInMonth(y, m);
  const byDay = new Map((cal?.days ?? []).map((d) => [Number(d.date.slice(8, 10)), d.entries]));
  const cells: Array<number | null> = [...Array(first).fill(null), ...Array.from({ length: nDays }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="rti-stack">
      {cal && (
          <div className="rti-row">
            <StatNumber
              label="Fixed costs this month"
              value={money(cal.fixedCostsCents)}
              detail={cal.estimatedCents > 0 ? `includes ≈ ${money(cal.estimatedCents)} of estimates` : "no estimates"}
            />
            <StatNumber label="Recurring income" value={money(cal.incomeCents)} />
          </div>
        )}
      <div className="rti-toolbar">
        <Button size="sm" aria-label="Previous month" onClick={() => setMonth(addMonthsToMonth(month, -1))}>
          ‹ Prev
        </Button>
        <h3 className="rec-cal__month" aria-live="polite">
          {monthName(month)}
        </h3>
        <Button size="sm" aria-label="Next month" onClick={() => setMonth(addMonthsToMonth(month, 1))}>
          Next ›
        </Button>
      </div>
      {q.error && <p className="rti-error">Couldn't load the calendar: {q.error.message}</p>}
      {cal && cal.days.length === 0 && (
        <EmptyState icon="recurring" title="Nothing recurring this month" description="Recurring charges, income and card statements appear on the day they hit." />
      )}
      <Card padding="none">
        <div className="rec-cal" role="table" aria-label={`Recurring charges in ${monthName(month)}`}>
          <div className="rec-cal__row" role="row">
            {WEEKDAYS.map((d) => (
              <div key={d} className="rec-cal__head" role="columnheader">
                {d}
              </div>
            ))}
          </div>
          {Array.from({ length: cells.length / 7 }, (_, w) => (
            <div key={w} className="rec-cal__row" role="row">
              {cells.slice(w * 7, w * 7 + 7).map((day, i) => (
                <div key={i} className={`rec-cal__cell${day === null ? " is-empty" : ""}`} role="cell">
                  {day !== null && (
                    <>
                      <span className="rec-cal__day">{day}</span>
                      {(byDay.get(day) ?? []).map((e, k) => (
                        <div key={k} className={`rec-cal__entry rec-cal__entry--${e.kind}`} title={`${e.name}: ${money(e.amountCents)}${e.isEstimate ? " (estimate)" : ""}`}>
                          <span className="rec-cal__name">{e.name}</span>
                          <span className="rti-num">
                            {e.kind === "income" ? "+" : ""}
                            {e.isEstimate ? "≈" : ""}
                            {money(e.amountCents, { noCents: true })}
                          </span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </Card>
      <p className="rti-note">≈ marks an estimate from recent amounts. Card statements are shown but not counted as fixed costs (the spending was already counted on the card).</p>
    </div>
  );
}
