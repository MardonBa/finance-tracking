import type { AnyQuery } from "../../registry.ts";
import {
  byCategory,
  cashFlow,
  categorySeriesQuery,
  cuttingBack,
  heatmapQuery,
  monthlySummaryQuery,
  necessity,
  notNecessaryTrendQuery,
  sankeyQuery,
  savedByDestinationQuery,
  topMerchantsQuery,
  worthALookQuery,
} from "./spendingQueries.ts";

/** Queries of the "spending" module. Every name must start with "spending.". Add files in this folder and list them here. */
export const queries: AnyQuery[] = [
  monthlySummaryQuery,
  cashFlow,
  byCategory,
  sankeyQuery,
  categorySeriesQuery,
  topMerchantsQuery,
  heatmapQuery,
  savedByDestinationQuery,
  necessity,
  notNecessaryTrendQuery,
  worthALookQuery,
  cuttingBack,
];
