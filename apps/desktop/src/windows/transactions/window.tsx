import { defineWindow } from "../../shell/registry.ts";
import { TransactionsWindow } from "./TransactionsWindow.tsx";

export default defineWindow({ area: "transactions", component: TransactionsWindow, minSize: { w: 560, h: 360 } });
