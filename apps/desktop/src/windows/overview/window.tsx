import { defineWindow } from "../../shell/registry.ts";
import { OverviewWindow } from "./OverviewWindow.tsx";

/** At this size every Overview card fits without scrolling (§13), alerts strip included. */
export default defineWindow({ area: "overview", component: OverviewWindow, defaultSize: { w: 920, h: 640 }, minSize: { w: 640, h: 480 } });
