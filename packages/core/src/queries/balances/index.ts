import type { AnyQuery } from "../../registry.ts";
import { balanceQueries } from "./balanceQueries.ts";

/** Queries of the "balances" module. Every name must start with "balances.". Add files in this folder and list them here. */
export const queries: AnyQuery[] = [...balanceQueries];
