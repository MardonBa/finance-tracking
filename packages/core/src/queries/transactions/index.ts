import type { AnyQuery } from "../../registry.ts";
import { drillDown, list, merchant, merchants } from "./transactionsQueries.ts";

/** Queries of the "transactions" module. Every name must start with "transactions.". Add files in this folder and list them here. */
export const queries: AnyQuery[] = [list, drillDown, merchant, merchants];
