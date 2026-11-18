import type { AnyAction } from "../../registry.ts";
import { setTransactionNote } from "./setTransactionNote.ts";

/** Actions of the "example" module (templates; safe to delete once real actions exist). */
export const actions: AnyAction[] = [setTransactionNote];
