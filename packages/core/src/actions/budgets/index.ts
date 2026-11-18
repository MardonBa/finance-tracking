import type { AnyAction } from "../../registry.ts";
import {
  createBudget,
  createPart,
  createTrip,
  deleteBudget,
  deletePart,
  deleteTrip,
  editBudget,
  editPart,
  editTrip,
} from "./budgetsActions.ts";

/** Actions of the "budgets" module. Every name must start with "budgets.". Add files in this folder and list them here. */
export const actions: AnyAction[] = [createBudget, editBudget, deleteBudget, createPart, editPart, deletePart, createTrip, editTrip, deleteTrip];
