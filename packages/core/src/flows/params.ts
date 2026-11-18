/** Shared zod params for the flows / spending / transactions / budgets queries. */
import { z } from "zod";
import type { IsoMonth } from "../dates.ts";
import { addMonthsToMonth } from "../dates.ts";
import { isoDateSchema, isoMonthSchema } from "../schemas.ts";

export const usualMonthsSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]).default(3);

export const rangeSchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .refine((r) => r.from <= r.to, { message: "from must be on or before to" });

export const monthParamsSchema = z.object({ month: isoMonthSchema });

/** A run of months ending with `endMonth` (default 12, at most 36). */
export const monthRunSchema = z.object({
  endMonth: isoMonthSchema,
  months: z.number().int().min(1).max(36).default(12),
});

export function monthRun(endMonth: IsoMonth, count: number): IsoMonth[] {
  const out: IsoMonth[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(addMonthsToMonth(endMonth, -i));
  return out;
}
