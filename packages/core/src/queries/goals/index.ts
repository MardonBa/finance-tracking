import type { AnyQuery } from "../../registry.ts";
import { goalQueries } from "./goalQueries.ts";

/** Queries of the "goals" module. Every name must start with "goals.". Add files in this folder and list them here. */
export const queries: AnyQuery[] = [...goalQueries];
