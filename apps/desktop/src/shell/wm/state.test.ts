import { describe, expect, it } from "vitest";
import { AREA_INFO, AREAS, type AreaId } from "../areas.ts";
import { deserialize, LAYOUT_KEY, loadLayout, saveLayout, serialize } from "./persist.ts";
import { clampRect, initialState, invariantProblems, resizeRect, wmReducer, type WMAction, type WMState } from "./state.ts";

const VP = { w: 1200, h: 720 };
const run = (s: WMState, ...actions: WMAction[]) => actions.reduce(wmReducer, s);
const ok = (s: WMState) => expect(invariantProblems(s)).toEqual([]);

describe("first run", () => {
  it("opens only the Overview, centred and focused", () => {
    const s = initialState(VP);
    ok(s);
    expect(s.order).toEqual(["overview"]);
    expect(s.focused).toBe("overview");
    const w = s.windows.overview!;
    expect(w.x + w.w / 2).toBeCloseTo(VP.w / 2, 0);
    expect(w.y + w.h / 2).toBeCloseTo(VP.h / 2, 0);
    expect(w.minimized).toBe(false);
  });
});

describe("one window per area", () => {
  it("opening an open area focuses it instead of adding a second", () => {
    let s = run(initialState(VP), { type: "open", area: "spending" }, { type: "open", area: "overview" });
    expect(s.order).toEqual(["spending", "overview"]);
    expect(Object.keys(s.windows)).toHaveLength(2);
    s = run(s, { type: "open", area: "overview" }, { type: "open", area: "overview" });
    expect(Object.keys(s.windows)).toHaveLength(2);
    expect(s.order.filter((a) => a === "overview")).toHaveLength(1);
    ok(s);
  });

  it("all nine areas can be open at once, each exactly once", () => {
    const s = run(initialState(VP), ...AREAS.map((area): WMAction => ({ type: "open", area })), ...AREAS.map((area): WMAction => ({ type: "open", area })));
    expect(s.order).toHaveLength(AREAS.length);
    expect(new Set(s.order).size).toBe(AREAS.length);
    ok(s);
  });

  it("opening a minimised area restores it", () => {
    const s = run(initialState(VP), { type: "minimize", area: "overview" }, { type: "open", area: "overview" });
    expect(s.windows.overview!.minimized).toBe(false);
    expect(s.focused).toBe("overview");
  });
});

describe("focus order", () => {
  const three = () => run(initialState(VP), { type: "open", area: "spending" }, { type: "open", area: "budgets" });

  it("new windows open in front and focused", () => {
    const s = three();
    expect(s.order).toEqual(["overview", "spending", "budgets"]);
    expect(s.focused).toBe("budgets");
    ok(s);
  });

  it("clicking a window brings it to the front", () => {
    const s = run(three(), { type: "focus", area: "overview" });
    expect(s.order).toEqual(["spending", "budgets", "overview"]);
    expect(s.focused).toBe("overview");
    ok(s);
  });

  it("closing the focused window focuses the next one down", () => {
    const s = run(three(), { type: "close", area: "budgets" });
    expect(s.focused).toBe("spending");
    expect(s.windows.budgets).toBeUndefined();
    ok(s);
  });

  it("closeFocused (⌘W) closes the focused window only", () => {
    let s = run(three(), { type: "closeFocused" });
    expect(s.order).toEqual(["overview", "spending"]);
    s = run(s, { type: "closeFocused" }, { type: "closeFocused" }, { type: "closeFocused" });
    expect(s.order).toEqual([]);
    expect(s.focused).toBeNull();
    ok(s);
  });

  it("minimising moves focus to the next visible window and skips minimised ones", () => {
    let s = run(three(), { type: "minimize", area: "spending" }, { type: "minimize", area: "budgets" });
    expect(s.focused).toBe("overview");
    ok(s);
    s = run(s, { type: "minimize", area: "overview" });
    expect(s.focused).toBeNull();
    ok(s);
  });

  it("minimised windows keep their place and come back from the dock", () => {
    const s = run(three(), { type: "minimize", area: "budgets" }, { type: "focus", area: "budgets" });
    expect(s.windows.budgets!.minimized).toBe(false);
    expect(s.focused).toBe("budgets");
    ok(s);
  });

  it("cycle visits every visible window and skips minimised ones", () => {
    let s = run(three(), { type: "open", area: "goals" }, { type: "minimize", area: "spending" });
    const seen: (AreaId | null)[] = [];
    for (let i = 0; i < 3; i++) {
      s = run(s, { type: "cycle", direction: 1 });
      seen.push(s.focused);
      ok(s);
    }
    expect(new Set(seen)).toEqual(new Set(["overview", "budgets", "goals"]));
    expect(seen).not.toContain("spending");
  });

  it("reverse cycle sends the front window to the back", () => {
    const s = run(three(), { type: "cycle", direction: -1 });
    expect(s.order[0]).toBe("budgets");
    expect(s.focused).toBe("spending");
    ok(s);
  });

  it("cycle with one window is a no-op", () => {
    const s = initialState(VP);
    expect(run(s, { type: "cycle", direction: 1 })).toBe(s);
  });
});

describe("clamping", () => {
  const min = { w: 300, h: 200 };

  it("keeps a rect fully inside the desktop", () => {
    expect(clampRect({ x: -50, y: -10, w: 400, h: 300 }, VP, min)).toEqual({ x: 0, y: 0, w: 400, h: 300 });
    expect(clampRect({ x: 1100, y: 700, w: 400, h: 300 }, VP, min)).toEqual({ x: 800, y: 420, w: 400, h: 300 });
  });

  it("shrinks windows bigger than the desktop and keeps the minimum size", () => {
    expect(clampRect({ x: 0, y: 0, w: 5000, h: 5000 }, VP, min)).toEqual({ x: 0, y: 0, w: 1200, h: 720 });
    expect(clampRect({ x: 10, y: 10, w: 10, h: 10 }, VP, min)).toEqual({ x: 10, y: 10, w: 300, h: 200 });
  });

  it("a desktop smaller than the minimum still contains the window", () => {
    expect(clampRect({ x: 50, y: 50, w: 400, h: 300 }, { w: 200, h: 100 }, min)).toEqual({ x: 0, y: 0, w: 200, h: 100 });
  });

  it("dragging can't take a window (or its title bar) outside", () => {
    let s = run(initialState(VP), { type: "move", area: "overview", x: -999, y: -999 });
    expect(s.windows.overview).toMatchObject({ x: 0, y: 0 });
    s = run(s, { type: "move", area: "overview", x: 99_999, y: 99_999 });
    const w = s.windows.overview!;
    expect(w.x + w.w).toBe(VP.w);
    expect(w.y + w.h).toBe(VP.h);
    ok(s);
  });

  it("re-clamps every window when the app window shrinks", () => {
    let s = run(initialState(VP), { type: "open", area: "spending" }, { type: "move", area: "spending", x: 900, y: 600 });
    s = run(s, { type: "setViewport", viewport: { w: 700, h: 450 } });
    ok(s);
    for (const a of s.order) {
      const w = s.windows[a]!;
      expect(w.x).toBeGreaterThanOrEqual(0);
      expect(w.y).toBeGreaterThanOrEqual(0);
      expect(w.x + w.w).toBeLessThanOrEqual(700);
      expect(w.y + w.h).toBeLessThanOrEqual(450);
    }
  });

  it("resizes from every edge and corner, stopping at the minimum and the desktop", () => {
    const start = { x: 100, y: 100, w: 500, h: 400 };
    expect(resizeRect(start, "se", 50, 30, VP, min)).toEqual({ x: 100, y: 100, w: 550, h: 430 });
    expect(resizeRect(start, "nw", -50, -30, VP, min)).toEqual({ x: 50, y: 70, w: 550, h: 430 });
    expect(resizeRect(start, "w", 400, 0, VP, min)).toEqual({ x: 300, y: 100, w: 300, h: 400 });
    expect(resizeRect(start, "n", 0, -500, VP, min)).toEqual({ x: 100, y: 0, w: 500, h: 500 });
    expect(resizeRect(start, "e", 5000, 0, VP, min)).toEqual({ x: 100, y: 100, w: 1100, h: 400 });
    expect(resizeRect(start, "s", 0, -1000, VP, min)).toEqual({ x: 100, y: 100, w: 500, h: 200 });
    expect(resizeRect(start, "ne", 10, 10, VP, min)).toEqual({ x: 100, y: 110, w: 510, h: 390 });
    expect(resizeRect(start, "sw", -10, 10, VP, min)).toEqual({ x: 90, y: 100, w: 510, h: 410 });
  });

  it("maximise fills the desktop, restores the old rect, and follows viewport changes", () => {
    let s = run(initialState(VP), { type: "toggleMaximize", area: "overview" });
    expect(s.windows.overview).toMatchObject({ x: 0, y: 0, w: VP.w, h: VP.h, maximized: true });
    s = run(s, { type: "setViewport", viewport: { w: 1400, h: 800 } });
    expect(s.windows.overview).toMatchObject({ w: 1400, h: 800 });
    const before = initialState(VP).windows.overview!;
    s = run(s, { type: "toggleMaximize", area: "overview" });
    expect(s.windows.overview).toMatchObject({ x: before.x, y: before.y, w: before.w, h: before.h, maximized: false });
    ok(s);
  });

  it("new windows cascade but stay inside", () => {
    let s = initialState({ w: 800, h: 600 });
    for (const area of AREAS) s = run(s, { type: "open", area });
    ok(s);
    const xs = s.order.map((a) => s.windows[a]!.x);
    expect(new Set(xs).size).toBeGreaterThan(1);
  });

  it("windows never go below their area's minimum size", () => {
    let s = run(initialState(VP), { type: "resize", area: "overview", rect: { x: 0, y: 0, w: 1, h: 1 } });
    expect(s.windows.overview!.w).toBe(AREA_INFO.overview.minSize.w);
    expect(s.windows.overview!.h).toBe(AREA_INFO.overview.minSize.h);
    s = run(s, { type: "setViewport", viewport: { w: 2000, h: 1500 } });
    ok(s);
  });
});

describe("persistence round-trip", () => {
  const busy = () =>
    run(
      initialState(VP),
      { type: "open", area: "spending" },
      { type: "open", area: "goals" },
      { type: "move", area: "spending", x: 40, y: 50 },
      { type: "resize", area: "goals", rect: { x: 300, y: 100, w: 500, h: 400 } },
      { type: "minimize", area: "overview" },
      { type: "toggleMaximize", area: "goals" },
      { type: "focus", area: "spending" },
    );

  it("restores open/minimised, positions, sizes, stacking and focus exactly", () => {
    const s = busy();
    ok(s);
    const back = deserialize(serialize(s), VP);
    expect(back).toEqual(s);
  });

  it("re-clamps a saved layout to a smaller app window", () => {
    const back = deserialize(serialize(busy()), { w: 600, h: 400 });
    ok(back);
    expect(back.order).toEqual(busy().order);
    expect(back.focused).toBe("spending");
  });

  it("falls back to the first-run layout on missing, corrupt or old data", () => {
    const first = initialState(VP);
    expect(deserialize(null, VP)).toEqual(first);
    expect(deserialize("{nope", VP)).toEqual(first);
    expect(deserialize(JSON.stringify({ version: 0 }), VP)).toEqual(first);
    expect(deserialize(JSON.stringify({ version: 1, windows: "x", order: [] }), VP)).toEqual(first);
  });

  it("drops unknown areas, duplicates and bad numbers", () => {
    const json = JSON.stringify({
      version: 1,
      windows: [
        { area: "overview", x: 10, y: 10, w: 500, h: 400, minimized: false, maximized: false, restore: null },
        { area: "overview", x: 99, y: 99, w: 500, h: 400 },
        { area: "casino", x: 10, y: 10, w: 500, h: 400 },
        { area: "goals", x: "a", y: 10, w: 500, h: 400 },
      ],
      order: ["casino", "overview", "overview"],
      focused: "casino",
    });
    const s = deserialize(json, VP);
    ok(s);
    expect(s.order).toEqual(["overview"]);
    expect(s.windows.overview).toMatchObject({ x: 10, y: 10 });
    expect(s.focused).toBe("overview");
  });

  it("an empty desktop (everything closed) stays empty", () => {
    const s = run(initialState(VP), { type: "close", area: "overview" });
    expect(deserialize(serialize(s), VP).order).toEqual([]);
  });

  it("load/save go through storage under one key and never throw", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    saveLayout(storage, busy());
    expect([...store.keys()]).toEqual([LAYOUT_KEY]);
    expect(loadLayout(storage, VP)).toEqual(busy());
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(loadLayout(broken, VP)).toEqual(initialState(VP));
    expect(() => saveLayout(broken, busy())).not.toThrow();
  });
});
