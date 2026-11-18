import type { AnyAction } from "../../registry.ts";
import { trajectoryActions } from "./trajectoryActions.ts";

/** Actions of the "trajectory" module. Every name must start with "trajectory.". Add files in this folder and list them here. */
export const actions: AnyAction[] = [...trajectoryActions];
