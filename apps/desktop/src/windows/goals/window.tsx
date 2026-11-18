import { defineWindow } from "../../shell/registry.ts";
import { GoalsWindow } from "./GoalsWindow.tsx";

export default defineWindow({ area: "goals", component: GoalsWindow, defaultSize: { w: 820, h: 620 }, minSize: { w: 440, h: 340 } });
