import { defineWindow } from "../../shell/registry.ts";
import { InvestmentsWindow } from "./InvestmentsWindow.tsx";

export default defineWindow({ area: "investments", component: InvestmentsWindow, defaultSize: { w: 820, h: 600 }, minSize: { w: 420, h: 320 } });
