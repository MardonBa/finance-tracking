import type { AnyQuery } from "../../registry.ts";
import { history, overview, period, trips } from "./budgetsQueries.ts";
import { config } from "./budgetsConfig.ts";

/** Queries of the "budgets" module. Every name must start with "budgets.". Add files in this folder and list them here. */
export const queries: AnyQuery[] = [overview, period, history, trips, config];
