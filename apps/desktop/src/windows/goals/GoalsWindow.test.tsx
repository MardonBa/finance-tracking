// @vitest-environment jsdom
/**
 * Goals window and celebrations against real core query outputs
 * (goalsFixture, today 2026-10-31): Bike $1,200 (complete), DGX Spark
 * $4,312/$6,000 with a new $4,200 milestone, Trip $0/$3,000, all on the HYSA.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { goalsFixture } from "@ft/core/fixtures";
import { createCoreBackend, type CoreBackend } from "../../test/coreBackend.tsx";
import { WithToken } from "../../test/render.tsx";
import { GoalsWindow } from "./GoalsWindow.tsx";
import { GoalCelebrations, resetCelebrationClaims } from "./GoalCelebrations.tsx";
import { setPictureStore, type PictureStore } from "./pictures.ts";

const h = vi.hoisted(() => ({ be: null as unknown as CoreBackend }));
vi.mock("../../api/client.ts", async (orig) => ({
  ...(await orig<typeof import("../../api/client.ts")>()),
  runQuery: (t: string, n: string, p: unknown) => h.be.runQuery(t, n, p),
  previewAction: (t: string, n: string, i: unknown) => h.be.previewAction(t, n, i),
  runAction: (t: string, n: string, i: unknown) => h.be.runAction(t, n, i),
  undoAction: (t: string, id: string) => h.be.undoAction(t, id),
}));

/** In-memory picture store (stands in for the app data dir / IndexedDB). */
function memoryStore(initial: Record<string, Blob> = {}): PictureStore {
  const m = new Map(Object.entries(initial));
  return { get: async (id) => m.get(id) ?? null, put: async (id, b) => void m.set(id, b), remove: async (id) => void m.delete(id) };
}

function setReducedMotion(reduced: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: reduced && q.includes("reduce"),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  h.be = createCoreBackend(goalsFixture());
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-31T12:00:00"));
  setPictureStore(memoryStore());
  resetCelebrationClaims();
  setReducedMotion(false);
  URL.createObjectURL = vi.fn(() => "blob:goal");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setPictureStore(null);
});

const renderWindow = () =>
  render(
    <WithToken>
      <GoalsWindow />
    </WithToken>,
  );

const renderCelebrations = () =>
  render(
    <WithToken>
      <GoalCelebrations durations={{ small: 60_000, big: 60_000 }} />
    </WithToken>,
  );

describe("goal cards", () => {
  it("shows each goal with its progress ring, deadline need, contribution status and projection", async () => {
    renderWindow();
    const card = (await screen.findByRole("heading", { name: "DGX Spark" })).closest("article")!;
    expect(within(card).getByRole("img", { name: "$4,312 of $6,000 saved, 71 percent" })).toBeTruthy();
    expect(card.textContent).toMatch(/need \$\d[\d,]*\/month to hit Jun 1, 2027/);
    expect(card.textContent).toMatch(/of \$300 this month/);
    expect(card.textContent).toMatch(/Projected|projected/);
    expect(within(card).getAllByText(/Ahead|Behind/).length).toBeGreaterThan(0);
  });

  it("a missing picture shows the placeholder and Add picture; adding one replaces it", async () => {
    renderWindow();
    const card = (await screen.findByRole("heading", { name: "Trip" })).closest("article")!;
    expect(await within(card).findByTestId("goal-picture-placeholder")).toBeTruthy();
    expect(within(card).getByRole("img", { name: "No picture of Trip on this Mac" })).toBeTruthy();
    const add = within(card).getByRole("button", { name: "Add picture" });
    expect(add).toBeTruthy();
    const input = card.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["png"], "trip.png", { type: "image/png" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    expect(await within(card).findByRole("img", { name: "Trip" })).toBeTruthy();
    // Pictures never go to the backend.
    expect(h.be.calls.filter((c) => c.kind === "action" && c.name !== "goals.markMilestonesSeen")).toEqual([]);
  });

  it("explains a loss from the Oct 20 withdrawal on the card", async () => {
    renderWindow();
    const card = (await screen.findByRole("heading", { name: "DGX Spark" })).closest("article")!;
    await waitFor(() => expect(card.textContent).toMatch(/lost/));
  });

  it("archives a completed goal as an achievement through goals.archive", async () => {
    renderWindow();
    const card = (await screen.findByRole("heading", { name: "Bike" })).closest("article")!;
    fireEvent.click(within(card).getByRole("button", { name: "Archive as achievement" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(h.be.actions("goals.archive")).toEqual([{ goalId: "goal_bike", archived: true }]));
  });
});

describe("planning: drag-to-reorder", () => {
  async function openPlan() {
    renderWindow();
    fireEvent.click(await screen.findByRole("tab", { name: "Plan" }));
    await screen.findByTestId("reorder-goal_bike");
  }

  it("keyboard: ArrowUp on DGX Spark's handle calls goals.reorder with DGX first", async () => {
    await openPlan();
    const handle = screen.getByRole("button", { name: /Reorder DGX Spark, priority 2 of 3/ });
    handle.focus();
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    await waitFor(() => expect(h.be.actions("goals.reorder")).toEqual([{ accountId: "acc_hysa", goalIds: ["goal_dgx", "goal_bike", "goal_trip"] }]));
    expect(await screen.findByText(/New order: DGX Spark → Bike → Trip/)).toBeTruthy();
    // Undo restores the previous order.
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(h.be.data.goals.find((g) => g.id === "goal_bike")!.priority).toBe(1));
  });

  it("mouse: dragging Bike below Trip previews live dates (goals.whatIf), shows a drop indicator, and commits the order", async () => {
    await openPlan();
    // jsdom has no layout: cards are 52px tall, 60px apart.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const i = Number(this.dataset.index ?? 0);
      return { top: i * 60, height: 52, bottom: i * 60 + 52, left: 0, right: 300, width: 300, x: 0, y: i * 60, toJSON: () => ({}) } as DOMRect;
    });
    const handle = screen.getByRole("button", { name: /Reorder Bike, priority 1 of 3/ });
    fireEvent.pointerDown(handle, { button: 0, clientY: 26 });
    expect(screen.getByTestId("reorder-goal_bike").className).toMatch(/is-lifted/);
    fireEvent.pointerMove(window, { clientY: 160 });
    expect(await screen.findByTestId("drop-indicator")).toBeTruthy();
    await waitFor(() => expect(h.be.queries("goals.whatIf")).toContainEqual({ accountId: "acc_hysa", contributionDeltaCents: 0, order: ["goal_dgx", "goal_trip", "goal_bike"] }));
    // Live preview: DGX would now finish sooner than before.
    await waitFor(() => expect(screen.getByTestId("projected-goal_dgx").textContent).toMatch(/Funded|sooner/));
    fireEvent.pointerUp(window, { clientY: 160 });
    await waitFor(() => expect(h.be.actions("goals.reorder")).toEqual([{ accountId: "acc_hysa", goalIds: ["goal_dgx", "goal_trip", "goal_bike"] }]));
    expect(screen.queryByTestId("drop-indicator")).toBeNull();
  });

  it("the what-if slider re-runs goals.whatIf with the extra contribution", async () => {
    await openPlan();
    fireEvent.change(screen.getByRole("slider"), { target: { value: "15000" } });
    await waitFor(() => expect(h.be.queries("goals.whatIf")).toContainEqual({ accountId: "acc_hysa", contributionDeltaCents: 15000 }));
  });

  it("shows the account bar split into protected, each goal and unassigned", async () => {
    await openPlan();
    const bar = await screen.findByRole("figure", { name: "HYSA split by goal" });
    expect(bar.textContent).toMatch(/Protected \$5,000/);
    expect(bar.textContent).toMatch(/Bike \$1,200/);
    expect(bar.textContent).toMatch(/DGX Spark \$4,312/);
    expect(bar.textContent).toMatch(/Unassigned \$0/);
  });
});

describe("celebrations", () => {
  it("plays once per goal (completion is the big one with the picture) and records them with goals.markMilestonesSeen", async () => {
    renderCelebrations();
    const first = await screen.findByTestId("goal-celebration");
    expect(first.className).toMatch(/gc-overlay--big/);
    expect(within(first).getByText("Bike")).toBeTruthy();
    expect(within(first).getByRole("img", { name: /picture of Bike/ })).toBeTruthy();
    await waitFor(() => expect(h.be.actions("goals.markMilestonesSeen")).toEqual([{ goalId: "goal_bike", milestonesCents: [30000, 60000, 90000, 120000] }]));
    fireEvent.click(within(first).getByRole("button", { name: "Celebrate" }));

    const second = await screen.findByTestId("goal-celebration");
    expect(second.className).toMatch(/gc-overlay--small/);
    expect(second.textContent).toMatch(/DGX Spark passed \$4,200/);
    await waitFor(() => expect(h.be.actions("goals.markMilestonesSeen")).toHaveLength(2));
    expect(h.be.actions("goals.markMilestonesSeen")[1]).toEqual({ goalId: "goal_dgx", milestonesCents: [420000] });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss celebration" }));
    await waitFor(() => expect(screen.queryByTestId("goal-celebration")).toBeNull());

    // Opening again (new session, no in-memory claims): nothing left to play.
    cleanup();
    resetCelebrationClaims();
    renderCelebrations();
    await waitFor(() => expect(h.be.queries("goals.celebrations").length).toBeGreaterThan(1));
    expect(screen.queryByTestId("goal-celebration")).toBeNull();
    expect(h.be.actions("goals.markMilestonesSeen")).toHaveLength(2);
  });

  it("two overlays mounted at once (Goals + Overview) never play the same milestone twice", async () => {
    render(
      <WithToken>
        <GoalCelebrations durations={{ small: 60_000, big: 60_000 }} />
        <GoalCelebrations durations={{ small: 60_000, big: 60_000 }} />
      </WithToken>,
    );
    await screen.findByTestId("goal-celebration");
    await waitFor(() => expect(h.be.actions("goals.markMilestonesSeen").length).toBeGreaterThan(0));
    expect(screen.getAllByTestId("goal-celebration")).toHaveLength(1);
  });

  it("under Reduce motion it's a gentle fade with no confetti", async () => {
    setReducedMotion(true);
    renderCelebrations();
    const el = await screen.findByTestId("goal-celebration");
    expect(el.dataset.motion).toBe("reduced");
    expect(screen.queryByTestId("confetti")).toBeNull();
  });

  it("with full motion it plays the confetti", async () => {
    renderCelebrations();
    const el = await screen.findByTestId("goal-celebration");
    expect(el.dataset.motion).toBe("full");
    expect(screen.getByTestId("confetti")).toBeTruthy();
  });

  it("plays on opening the Goals window", async () => {
    renderWindow();
    expect(await screen.findByTestId("goal-celebration")).toBeTruthy();
  });
});
