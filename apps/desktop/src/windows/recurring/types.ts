/** Shapes of the recurring registry queries' values (from @ft/core). */
import type { Recurring } from "@ft/core";

export type AccountProjection = Recurring.AccountProjection;
export type BelowZeroWarning = Recurring.BelowZeroWarning;
export type ProjectionEvent = Recurring.ProjectionEvent;
export type CardPayment = Recurring.CardPayment;
export type MonthCalendar = Recurring.MonthCalendar;
export type CalendarEntry = Recurring.CalendarEntry;

export interface UpcomingValue {
  projections: AccountProjection[];
  warnings: BelowZeroWarning[];
  cardPayments: CardPayment[];
}

export type ListItem = Recurring.MergedRecurring & { accountName: string };

export interface ListValue extends Omit<Recurring.MergeResult, "items"> {
  items: ListItem[];
}

export interface AccountRow {
  id: string;
  name: string;
  kind: string;
  group: string;
  isDebt: boolean;
  hidden: boolean;
  balanceCents: number | null;
  connectedOn: string;
  historyStart: { startsOn: string | null; estimatedUntil: string | null; reason: string };
}
