/**
 * The query registry. Do not add queries here: add them to your module's
 * folder (queries/<module>/) and its index.ts barrel. Each module owns its
 * own barrel so parallel work never edits the same lines.
 */
import { buildRegistry, type AnyQuery } from "../registry.ts";
import { queries as example } from "./example/index.ts";
import { queries as flows } from "./flows/index.ts";
import { queries as balances } from "./balances/index.ts";
import { queries as accounts } from "./accounts/index.ts";
import { queries as transactions } from "./transactions/index.ts";
import { queries as spending } from "./spending/index.ts";
import { queries as budgets } from "./budgets/index.ts";
import { queries as goals } from "./goals/index.ts";
import { queries as recurring } from "./recurring/index.ts";
import { queries as trajectory } from "./trajectory/index.ts";
import { queries as investments } from "./investments/index.ts";
import { queries as overview } from "./overview/index.ts";
import { queries as connections } from "./connections/index.ts";

export const queryModules: Record<string, readonly AnyQuery[]> = {
  example,
  flows,
  balances,
  accounts,
  transactions,
  spending,
  budgets,
  goals,
  recurring,
  trajectory,
  investments,
  overview,
  connections,
};

export const queryRegistry = buildRegistry(queryModules);
