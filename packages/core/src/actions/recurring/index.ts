import type { AnyAction } from "../../registry.ts";
import { recurringActions } from "./recurringActions.ts";

/** Actions of the "recurring" module. Every name must start with "recurring.". Add files in this folder and list them here. */
export const actions: AnyAction[] = [...recurringActions];
