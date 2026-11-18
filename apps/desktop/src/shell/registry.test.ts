import { describe, expect, it, vi } from "vitest";
import { AREA_INFO, AREAS } from "./areas.ts";
import { PLACEHOLDERS } from "./placeholders.tsx";
import { defineWindow, registeredWindow, registerModules, registerWindow } from "./registry.ts";
import { windowComponent } from "./windows.ts";

describe("window registration API", () => {
  it("every area has a placeholder until Phase 2 registers a window", () => {
    for (const area of AREAS) {
      if (!registeredWindow(area)) expect(windowComponent(area)).toBe(PLACEHOLDERS[area]);
    }
  });

  it("a registered window replaces the placeholder and can override sizes", () => {
    const Spending = () => null;
    registerWindow(defineWindow({ area: "spending", component: Spending, minSize: { w: 400, h: 300 } }));
    expect(windowComponent("spending")).toBe(Spending);
    expect(AREA_INFO.spending.minSize).toEqual({ w: 400, h: 300 });
  });

  it("discovers default exports and skips invalid modules", () => {
    const Goals = () => null;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const areas = registerModules({
      "../windows/goals/window.tsx": { default: defineWindow({ area: "goals", component: Goals }) },
      "../windows/bad/window.tsx": { default: { area: "casino", component: Goals } },
      "../windows/empty/window.tsx": {},
    });
    expect(areas).toEqual(["goals"]);
    expect(windowComponent("goals")).toBe(Goals);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("rejects unknown areas", () => {
    // @ts-expect-error not an area
    expect(() => registerWindow({ area: "casino", component: () => null })).toThrow();
  });
});
