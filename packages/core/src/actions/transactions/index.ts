import type { AnyAction } from "../../registry.ts";
import {
  mergeMerchants,
  recategorise,
  separateMerchant,
  setNecessity,
  setNote,
  setTags,
  split,
  unsplit,
} from "./transactionsActions.ts";

/** Actions of the "transactions" module. Every name must start with "transactions.". Add files in this folder and list them here. */
export const actions: AnyAction[] = [recategorise, setNote, setTags, setNecessity, split, unsplit, mergeMerchants, separateMerchant];
