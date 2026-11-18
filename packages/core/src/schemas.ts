/** Reusable zod schemas for query params and action inputs. */
import { z } from "zod";
import { isIsoDate, isIsoMonth } from "./dates.ts";
import { isCents } from "./money.ts";

export const isoDateSchema = z.string().refine(isIsoDate, { message: "Expected a date as YYYY-MM-DD" });
export const isoMonthSchema = z.string().refine(isIsoMonth, { message: "Expected a month as YYYY-MM" });
export const centsSchema = z.number().refine(isCents, { message: "Expected whole cents (an integer)" });
export const idSchema = z.string().min(1).max(64);

/** Inclusive date range; from must not be after to. */
export const dateRangeSchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .refine((r) => r.from <= r.to, { message: "from must be on or before to" });
