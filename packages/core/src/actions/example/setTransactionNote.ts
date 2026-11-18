import { z } from "zod";
import { ActionError, defineAction, findRow } from "../../registry.ts";
import type { TransactionOverride } from "../../types.ts";
import { idSchema } from "../../schemas.ts";

/**
 * Example action (template for real ones): set or clear the note on a
 * transaction. The inverse comes from the generic `inverseMutations`.
 */
export const setTransactionNote = defineAction({
  name: "example.setTransactionNote",
  description: "Set or clear the note on one transaction (example action).",
  input: z.object({ transactionId: idSchema, note: z.string().max(2000).nullable() }),
  needs: ["transactions", "overrides"],
  examples: [
    { transactionId: "tx_card_purchase_dining", note: "Coffee with Sam" },
    { transactionId: "tx_poker_in", note: null },
  ],
  describe(data, input) {
    const tx = findRow(data, "transactions", { id: input.transactionId });
    if (!tx) throw new ActionError(`No transaction ${input.transactionId}`);
    const before = findRow(data, "overrides", { transactionId: input.transactionId })?.note ?? null;
    return {
      summary: `${input.note ? "Set" : "Clear"} the note on "${tx.merchantName ?? tx.rawDescription}"`,
      changes: [{ label: "Note", before, after: input.note }],
    };
  },
  apply(data, input, ctx) {
    if (!findRow(data, "transactions", { id: input.transactionId })) {
      throw new ActionError(`No transaction ${input.transactionId}`);
    }
    const existing = findRow(data, "overrides", { transactionId: input.transactionId });
    const row: TransactionOverride = {
      transactionId: input.transactionId,
      category: null,
      bucket: null,
      necessity: null,
      confirmedAt: null,
      ...existing,
      note: input.note,
      updatedAt: ctx.now,
    };
    return [{ op: "upsert", table: "overrides", row }];
  },
});
