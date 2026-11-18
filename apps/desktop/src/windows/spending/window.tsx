import { defineWindow } from "../../shell/registry.ts";
import { SpendingWindow } from "./SpendingWindow.tsx";

function Spending() {
  return <SpendingWindow />;
}

export default defineWindow({ area: "spending", component: Spending, defaultSize: { w: 860, h: 660 }, minSize: { w: 560, h: 400 } });
