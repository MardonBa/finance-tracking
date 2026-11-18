import type { AnyAction } from "../../registry.ts";
import {
  confirm,
  deleteRule,
  linkRefund,
  markPoker,
  markTransfer,
  setBucket,
  unlinkRefund,
  unmarkTransfer,
} from "./flowsActions.ts";

/** Actions of the "flows" module. Every name must start with "flows.". Add files in this folder and list them here. */
export const actions: AnyAction[] = [setBucket, markTransfer, unmarkTransfer, linkRefund, unlinkRefund, markPoker, confirm, deleteRule];
