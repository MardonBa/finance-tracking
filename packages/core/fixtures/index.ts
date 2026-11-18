/**
 * Hand-built test fixtures. Import from tests as:
 *   import { basicFixture } from "@ft/core/fixtures";
 */
import type { CoreData } from "../src/types.ts";
import type { IsoDate } from "../src/dates.ts";
import basic from "./basic.json" with { type: "json" };

export interface Fixture {
  today: IsoDate;
  data: CoreData;
}

/** A fresh deep copy each call, so tests can't leak changes into each other. */
export function basicFixture(): Fixture {
  const { today, data } = JSON.parse(JSON.stringify(basic)) as Fixture;
  return { today, data };
}

/** The core-flows fixture: four months of a typical life, "today" is 2026-10-20. */
export { flowsFixture, type FlowsFixture } from "./flows.ts";
