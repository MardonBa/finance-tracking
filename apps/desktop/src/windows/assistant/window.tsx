import { defineWindow } from "../../shell/registry.ts";
import { AssistantWindow } from "./AssistantWindow.tsx";

export default defineWindow({ area: "assistant", component: AssistantWindow, defaultSize: { w: 520, h: 680 }, minSize: { w: 360, h: 420 } });
