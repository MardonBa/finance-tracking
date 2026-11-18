import type { AnyQuery } from "../../registry.ts";
import { sumTransactions } from "./sumTransactions.ts";

/** Queries of the "example" module (templates; safe to delete once real queries exist). */
export const queries: AnyQuery[] = [sumTransactions];
