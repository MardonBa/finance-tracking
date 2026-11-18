import { z } from "zod";
import { defineQuery } from "../../registry.ts";
import { LEDGER_NEEDS, buildLedger } from "../../flows/ledger.ts";
import { PLAID_PRIMARY_CATEGORIES, UNCATEGORIZED, categoryLabel, primaryOf } from "../../flows/categories.ts";

/**
 * Choices for the transactions filters and row fixes (§7): every category in
 * use (detailed and broad) plus Plaid's broad ones, and every tag. Accounts
 * come from `accounts.list`.
 */
export const filterOptions = defineQuery({
  name: "transactions.filterOptions",
  description: "The categories (in use and Plaid's broad ones) and tags to filter by or pick from when fixing a transaction.",
  params: z.object({}),
  needs: [...LEDGER_NEEDS, "tags"],
  examples: [{}],
  run(data) {
    const ledger = buildLedger(data);
    const used = new Set<string>();
    for (const e of ledger.entries) {
      used.add(e.category);
      used.add(e.categoryPrimary);
    }
    for (const p of PLAID_PRIMARY_CATEGORIES) used.add(p);
    used.delete(UNCATEGORIZED);
    const categories = [...used]
      .map((c) => ({ category: c, label: categoryLabel(c), primary: primaryOf(c), isPrimary: primaryOf(c) === c }))
      .sort((a, b) =>
        a.primary !== b.primary ? (a.primary < b.primary ? -1 : 1) : a.isPrimary !== b.isPrimary ? (a.isPrimary ? -1 : 1) : a.category < b.category ? -1 : 1,
      );
    const tags = [...data.tags].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map((t) => ({ id: t.id, name: t.name }));
    return { value: { categories, tags }, figures: {} };
  },
});
