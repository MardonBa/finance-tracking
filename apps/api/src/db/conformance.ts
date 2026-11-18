/**
 * Compile-time check (runs in `npm run typecheck`): every @ft/core domain
 * type is exactly the matching D1 row minus backend-only columns. If a
 * column or a field is added on one side only, this file stops compiling
 * and names the slice.
 */
import type { CoreData, DataKey } from "@ft/core";
import type { TABLES } from "./tables.ts";

type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type CoreRow<K extends DataKey> = CoreData[K][number];
type DbRow<K extends DataKey> = (typeof TABLES)[K]["$inferSelect"];
type Secret = "accessTokenEnc" | "transactionsCursor";

type SliceMatches<K extends DataKey> =
  Equals<Omit<DbRow<K>, Secret>, CoreRow<K>> extends true ? true : { mismatch: K; db: Omit<DbRow<K>, Secret>; core: CoreRow<K> };

type AllSlices = { [K in DataKey]: SliceMatches<K> };

export const schemaMatchesCore: { [K in DataKey]: true } = null as unknown as AllSlices;
