import { defineWindow } from "../../shell/registry.ts";
import { BudgetsWindow } from "./BudgetsWindow.tsx";

export default defineWindow({ area: "budgets", component: BudgetsWindow, defaultSize: { w: 780, h: 600 }, minSize: { w: 420, h: 320 } });
