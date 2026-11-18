import { defineWindow } from "../../shell/registry.ts";
import { RecurringWindow } from "./RecurringWindow.tsx";

export default defineWindow({ area: "recurring", component: RecurringWindow, defaultSize: { w: 820, h: 600 }, minSize: { w: 420, h: 320 } });
