/**
 * Notes on investment activity (§17 "Activity … with notes allowed", §7).
 * Investment transactions (buys, sells, dividends, fees) live in their own
 * slice, so `transactions.setNote` can't reach them; this is its twin.
 * The note is stored on the row itself. The inverse comes from the generic
 * `inverseMutations` (the previous row is restored).
 */
import { z } from "zod";
import { ActionError, defineAction, findRow } from "../../registry.ts";
import { Money } from "../../money.ts";
import { idSchema } from "../../schemas.ts";
import type { CoreData, InvestmentTransaction } from "../../types.ts";

function need(data: Pick<CoreData, "investmentTransactions">, id: string): InvestmentTransaction {
  const t = findRow(data, "investmentTransactions", { id });
  if (!t) throw new ActionError(`No investment activity ${id}`);
  return t;
}

const label = (t: InvestmentTransaction) => `${t.rawDescription} (${t.date}, ${Money.format(t.amountCents)})`;
const clean = (note: string | null) => (note && note.trim().length > 0 ? note : null);

export const setInvestmentNote = defineAction({
  name: "investments.setNote",
  description: "Add, edit or remove the note on an investment activity (buy, sell, dividend, fee, transfer).",
  input: z.object({ investmentTransactionId: idSchema, note: z.string().max(2000).nullable() }),
  needs: ["investmentTransactions"],
  examples: [
    { investmentTransactionId: "itx_dividend", note: "Quarterly VTI dividend" },
    { investmentTransactionId: "itx_dividend", note: null },
  ],
  describe(data, input) {
    const t = need(data, input.investmentTransactionId);
    const note = clean(input.note);
    return { summary: `${note ? "Set" : "Remove"} the note on ${label(t)}`, changes: [{ label: "Note", before: t.note, after: note }] };
  },
  apply(data, input) {
    const t = need(data, input.investmentTransactionId);
    return [{ op: "upsert", table: "investmentTransactions", row: { ...t, note: clean(input.note) } }];
  },
});
