import type { AnyQuery } from "../../registry.ts";
import {
  buckets,
  incomeLines,
  needsALookQuery,
  netWorthEquationQuery,
  poker,
  reconciliation,
  refundSuggestions,
  transfers,
} from "./flowsQueries.ts";

/** Queries of the "flows" module. Every name must start with "flows.". Add files in this folder and list them here. */
export const queries: AnyQuery[] = [
  buckets,
  needsALookQuery,
  transfers,
  refundSuggestions,
  poker,
  reconciliation,
  netWorthEquationQuery,
  incomeLines,
];
