/**
 * The action registry. Do not add actions here: add them to your module's
 * folder (actions/<module>/) and its index.ts barrel. Each module owns its
 * own barrel so parallel work never edits the same lines.
 */
import { buildRegistry, type AnyAction } from "../registry.ts";
import { actions as example } from "./example/index.ts";
import { actions as flows } from "./flows/index.ts";
import { actions as balances } from "./balances/index.ts";
import { actions as accounts } from "./accounts/index.ts";
import { actions as transactions } from "./transactions/index.ts";
import { actions as spending } from "./spending/index.ts";
import { actions as budgets } from "./budgets/index.ts";
import { actions as goals } from "./goals/index.ts";
import { actions as recurring } from "./recurring/index.ts";
import { actions as trajectory } from "./trajectory/index.ts";
import { actions as investments } from "./investments/index.ts";
import { actions as overview } from "./overview/index.ts";
import { actions as connections } from "./connections/index.ts";

export const actionModules: Record<string, readonly AnyAction[]> = {
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

export const actionRegistry = buildRegistry(actionModules);
