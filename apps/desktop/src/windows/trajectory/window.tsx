import { defineWindow } from "../../shell/registry.ts";
import { TrajectoryWindow } from "./TrajectoryWindow.tsx";

export default defineWindow({ area: "trajectory", component: TrajectoryWindow, defaultSize: { w: 900, h: 640 }, minSize: { w: 480, h: 360 } });
