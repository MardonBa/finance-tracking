import type { AnyAction } from "../../registry.ts";
import { addCuttingBack, removeCuttingBack, setNecessityLabel } from "./spendingActions.ts";

/** Actions of the "spending" module. Every name must start with "spending.". Add files in this folder and list them here. */
export const actions: AnyAction[] = [setNecessityLabel, addCuttingBack, removeCuttingBack];
