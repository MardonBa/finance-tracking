// @vitest-environment happy-dom
/**
 * The desktop shell rendered for real (§14): windows with title bars and
 * minimise / maximise / close, the dock opening or focusing an area (one
 * window each), focus highlight, minimise to the dock and back, dragging by
 * the title bar and resizing from an edge, ⌘W, and opening animations that
 * respect Reduce motion. Window contents are stand-ins; the reducer rules
 * themselves are in wm/state.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Shell } from "./Shell.tsx";

vi.mock("./windows.ts", () => ({ windowComponent: (area: string) => () => <p>{area} contents</p> }));

const VIEW = { w: 1200, h: 800 };
let reduced = false;

beforeEach(() => {
  localStorage.clear();
  reduced = false;
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => VIEW.w });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => VIEW.h });
  window.matchMedia = ((q: string) => ({ matches: reduced && q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.releasePointerCapture = () => {};
});
afterEach(() => cleanup());

const win = (title: string) => screen.getByRole("region", { name: title }) as HTMLElement;
const dock = (title: string) => within(screen.getByRole("navigation", { name: "Dock" })).getByRole("button", { name: new RegExp(`^${title}(,|$)`) });
const flushFrames = () => act(() => new Promise((r) => setTimeout(r, 40)));

describe("the desktop shell (§14)", () => {
  it("first run: only the Overview, with a title bar and minimise, maximise and close", () => {
    render(<Shell token="t" onAddBanks={() => {}} />);
    expect(screen.getAllByRole("region")).toHaveLength(1);
    const ov = win("Overview");
    for (const b of ["Minimise Overview", "Maximise Overview", "Close Overview"]) expect(within(ov).getByRole("button", { name: b })).toBeTruthy();
    expect(ov.className).toContain("is-focused");
    expect(within(ov).getByText("overview contents")).toBeTruthy();
  });

  it("the dock opens an area or brings it to the front; one window per area; focus is visible", () => {
    render(<Shell token="t" onAddBanks={() => {}} />);
    fireEvent.click(dock("Spending"));
    expect(win("Spending").className).toContain("is-focused");
    expect(win("Overview").className).toContain("is-background");
    fireEvent.click(dock("Overview"));
    fireEvent.click(dock("Spending"));
    expect(screen.getAllByRole("region", { name: "Spending" })).toHaveLength(1);
    // Clicking a background window focuses it.
    fireEvent.pointerDown(win("Overview"));
    expect(win("Overview").className).toContain("is-focused");
    expect(Number(win("Overview").style.zIndex)).toBeGreaterThan(Number(win("Spending").style.zIndex));
  });

  it("minimise goes to the dock and comes back from it; maximise fills the desktop; close removes it", () => {
    reduced = true; // no animation timing in the way
    render(<Shell token="t" onAddBanks={() => {}} />);
    fireEvent.click(dock("Spending"));
    fireEvent.click(within(win("Spending")).getByRole("button", { name: "Minimise Spending" }));
    expect(dock("Spending").getAttribute("aria-label")).toBe("Spending, minimised");
    expect(document.querySelector('[data-area="spending"]')!.className).toContain("is-minimized");
    fireEvent.click(dock("Spending"));
    expect(win("Spending").className).toContain("is-focused");
    fireEvent.click(within(win("Spending")).getByRole("button", { name: "Maximise Spending" }));
    expect(win("Spending").style.width).toBe(`${VIEW.w}px`);
    expect(win("Spending").style.height).toBe(`${VIEW.h}px`);
    fireEvent.click(within(win("Spending")).getByRole("button", { name: "Close Spending" }));
    expect(document.querySelector('[data-area="spending"]')).toBeNull();
  });

  it("drags by the title bar and resizes from an edge, staying inside the desktop", async () => {
    render(<Shell token="t" onAddBanks={() => {}} />);
    const ov = win("Overview");
    const before = ov.style.transform;
    const bar = ov.querySelector(".wm-window__titlebar") as HTMLElement;
    fireEvent.pointerDown(bar, { pointerId: 1, clientX: 500, clientY: 100, button: 0 });
    fireEvent.pointerMove(bar, { pointerId: 1, clientX: 5000, clientY: 5000 });
    await flushFrames();
    fireEvent.pointerUp(bar, { pointerId: 1, clientX: 5000, clientY: 5000 });
    await flushFrames();
    const [, x, y] = /translate3d\((\d+)px, (\d+)px/.exec(ov.style.transform)!;
    expect(ov.style.transform).not.toBe(before);
    expect(Number(x) + parseInt(ov.style.width)).toBe(VIEW.w); // stopped at the edge
    expect(Number(y) + parseInt(ov.style.height)).toBe(VIEW.h);

    const w0 = parseInt(ov.style.width);
    const west = ov.querySelector(".wm-resize--w") as HTMLElement;
    fireEvent.pointerDown(west, { pointerId: 2, clientX: 300, clientY: 300, button: 0 });
    fireEvent.pointerMove(west, { pointerId: 2, clientX: 200, clientY: 300 });
    await flushFrames();
    fireEvent.pointerUp(west, { pointerId: 2, clientX: 200, clientY: 300 });
    await flushFrames();
    expect(parseInt(ov.style.width)).toBe(w0 + 100);
  });

  it("⌘W closes the focused window", () => {
    render(<Shell token="t" onAddBanks={() => {}} />);
    fireEvent.click(dock("Budgets"));
    fireEvent.keyDown(window, { key: "w", code: "KeyW", metaKey: true });
    expect(screen.queryByRole("region", { name: "Budgets" })).toBeNull();
    expect(win("Overview").className).toContain("is-focused");
  });

  it("opening animates, and under Reduce motion it doesn't", () => {
    render(<Shell token="t" onAddBanks={() => {}} />);
    fireEvent.click(dock("Goals"));
    expect(win("Goals").className).toContain("is-opening");
    cleanup();
    localStorage.clear();
    reduced = true;
    render(<Shell token="t" onAddBanks={() => {}} />);
    fireEvent.click(dock("Goals"));
    expect(win("Goals").className).not.toMatch(/is-opening/);
  });
});
