import { z } from "zod";
import { ActionError, defineAction, findRow, type Mutation } from "../../registry.ts";
import { LABEL_TARGET_KINDS, NECESSITY, type CuttingBackItem, type NecessaryLabel } from "../../types.ts";
import { idSchema } from "../../schemas.ts";
import { restoreInverse } from "../../flows/actionHelpers.ts";
import { categoryLabel } from "../../flows/categories.ts";

const targetText = (kind: string, value: string) => (kind === "category" ? categoryLabel(value) : value.replace(/^auto:/, ""));
const necessityText = (n: string | null) => (n === null ? "Not set" : n === "necessary" ? "Necessary" : "Not necessary");

export const setNecessityLabel = defineAction({
  name: "spending.setNecessityLabel",
  description: "Label a category or merchant as necessary or not necessary, or clear the label (there are no defaults).",
  input: z.object({ targetKind: z.enum(LABEL_TARGET_KINDS), targetValue: z.string().min(1).max(200), necessity: z.enum(NECESSITY).nullable() }),
  needs: ["necessaryLabels"],
  examples: [
    { targetKind: "category", targetValue: "FOOD_AND_DRINK_COFFEE", necessity: "not_necessary" },
    { targetKind: "merchant", targetValue: "auto:TRADER JOES", necessity: "necessary" },
  ],
  describe(data, input) {
    const cur = data.necessaryLabels.find((l) => l.targetKind === input.targetKind && l.targetValue === input.targetValue);
    return {
      summary: `Label ${targetText(input.targetKind, input.targetValue)}`,
      changes: [{ label: "Necessary?", before: necessityText(cur?.necessity ?? null), after: necessityText(input.necessity) }],
    };
  },
  apply(data, input, ctx) {
    const cur = data.necessaryLabels.find((l) => l.targetKind === input.targetKind && l.targetValue === input.targetValue);
    if (input.necessity === null) return cur ? [{ op: "delete", table: "necessaryLabels", key: { id: cur.id } }] : [];
    const row: NecessaryLabel = cur
      ? { ...cur, necessity: input.necessity }
      : { id: ctx.newId(), targetKind: input.targetKind, targetValue: input.targetValue, necessity: input.necessity };
    return [{ op: "upsert", table: "necessaryLabels", row }];
  },
  inverse: restoreInverse,
});

export const addCuttingBack = defineAction({
  name: "spending.addCuttingBack",
  description: "Put a category or merchant on the cutting-back list, to see month by month whether it goes down.",
  input: z.object({ targetKind: z.enum(LABEL_TARGET_KINDS), targetValue: z.string().min(1).max(200) }),
  needs: ["cuttingBack"],
  examples: [{ targetKind: "category", targetValue: "FOOD_AND_DRINK" }],
  describe(_data, input) {
    return {
      summary: `Cut back on ${targetText(input.targetKind, input.targetValue)}`,
      changes: [{ label: "Cutting back", before: null, after: targetText(input.targetKind, input.targetValue) }],
    };
  },
  apply(data, input, ctx) {
    if (data.cuttingBack.some((c) => c.targetKind === input.targetKind && c.targetValue === input.targetValue && c.endedOn === null)) {
      throw new ActionError("Already on the cutting-back list");
    }
    const row: CuttingBackItem = { id: ctx.newId(), targetKind: input.targetKind, targetValue: input.targetValue, startedOn: ctx.today, endedOn: null };
    return [{ op: "upsert", table: "cuttingBack", row }];
  },
  inverse: restoreInverse,
});

export const removeCuttingBack = defineAction({
  name: "spending.removeCuttingBack",
  description: "Take an item off the cutting-back list (its history stays viewable).",
  input: z.object({ id: idSchema }),
  needs: ["cuttingBack"],
  describe(data, input) {
    const c = findRow(data, "cuttingBack", { id: input.id });
    if (!c) throw new ActionError(`No cutting-back item ${input.id}`);
    return { summary: `Stop cutting back on ${targetText(c.targetKind, c.targetValue)}`, changes: [{ label: "Cutting back", before: targetText(c.targetKind, c.targetValue), after: null }] };
  },
  apply(data, input, ctx) {
    const c = findRow(data, "cuttingBack", { id: input.id });
    if (!c || c.endedOn !== null) throw new ActionError(`No active cutting-back item ${input.id}`);
    // Added today and removed today: nothing to keep.
    if (c.startedOn >= ctx.today) return [{ op: "delete", table: "cuttingBack", key: { id: c.id } }] satisfies Mutation[];
    return [{ op: "upsert", table: "cuttingBack", row: { ...c, endedOn: ctx.today } }];
  },
  inverse: restoreInverse,
});
