// @vitest-environment jsdom
/**
 * Every registered window, rendered against real core outputs (§15 "Intuitive",
 * "Uncluttered"; §16 "Explain"):
 *  - each area has a window and one main question, shown in its dock tooltip
 *    and title bar;
 *  - every control has an accessible name, and every icon-only button also
 *    has a visible tooltip;
 *  - every window but Transactions and the assistant has an "Explain" button
 *    whose figure is a real registry query with valid params;
 *  - with no data at all, each window still loads, and says what goes there
 *    and offers a next step.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { emptyData, queryRegistry } from "@ft/core";
import { goalsFixture } from "@ft/core/fixtures";
import { coreData, resetCore, TODAY } from "../test/coreBackend.tsx";
import { renderInWindow } from "../test/render.tsx";
import { AREA_INFO, AREAS, type AreaId } from "../shell/areas.ts";
import { registeredWindow } from "../shell/registry.ts";
import { windowComponent } from "../shell/windows.ts";
import { Dock } from "../shell/Dock.tsx";
import { initialState } from "../shell/wm/state.ts";
import { EXPLAIN_EVENT, takePendingExplain, type ExplainFigure } from "./assistant/explain.ts";
import { setPictureStore } from "./goals/pictures.ts";
import { resetCelebrationClaims } from "./goals/GoalCelebrations.tsx";

vi.mock("../api/client.ts", async () => {
  const { clientMock } = await import("../test/coreBackend.tsx");
  // Connection health, credentials and the assistant's own routes: nothing to report.
  const other = async (path: string) => (path === "/connections" ? { items: [] } : path === "/auth/credentials" ? { credentials: [] } : {});
  return { ...clientMock, apiRequest: other, call: other };
});
vi.mock("../ui/Chart.tsx", () => import("../test/chartStub.tsx"));
// The assistant's own routes (never Gemini): two ready-made prompts, an empty log, and a chat that never answers.
vi.mock("./assistant/api.ts", async (orig) => ({
  ...(await orig<typeof import("./assistant/api.ts")>()),
  builtInPrompts: async () => [
    { id: "top", label: "What am I spending the most on this month?" },
    { id: "cut", label: "Where can I cut back?" },
  ],
  actionLog: async () => [],
  chat: () => new Promise(() => {}),
}));

const NO_EXPLAIN: AreaId[] = ["transactions", "assistant"];

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
});
beforeEach(() => {
  resetCore();
  resetCelebrationClaims();
  setPictureStore({ get: async () => null, put: async () => {}, remove: async () => {} });
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  takePendingExplain();
});

async function renderArea(area: AreaId) {
  const C = windowComponent(area);
  const r = renderInWindow(<C />, area);
  await waitFor(() => expect(within(r.container).queryAllByText(/^(Loading…|Searching…|Looking for the purchase…)$/)).toEqual([]));
  return r;
}

const ROLES = ["button", "tab", "radio", "switch", "checkbox", "combobox", "textbox", "searchbox", "spinbutton", "slider", "link"] as const;

describe("every area has a window that answers one main question (§15)", () => {
  it.each(AREAS)("%s is registered and has a question", (area) => {
    expect(registeredWindow(area), `${area} has no window.tsx`).toBeDefined();
    expect(AREA_INFO[area].question).toMatch(/^[A-Z].*\?$/);
  });

  it("the questions are all different, and each shows in the dock tooltip", () => {
    const qs = AREAS.map((a) => AREA_INFO[a].question);
    expect(new Set(qs).size).toBe(qs.length);
    render(<Dock state={initialState({ w: 1200, h: 800 })} dispatch={() => {}} />);
    const tips = screen.getAllByRole("tooltip", { hidden: true }).map((t) => t.textContent);
    for (const a of AREAS) expect(tips.some((t) => t?.includes(AREA_INFO[a].question))).toBe(true);
  });
});

describe.each(AREAS)("%s window with data", (area) => {
  it("every control has a name, and icon-only buttons have a tooltip", async () => {
    const { container } = await renderArea(area);
    const c = within(container);
    for (const role of ROLES) {
      const all = c.queryAllByRole(role);
      const named = new Set(c.queryAllByRole(role, { name: /\S/ }));
      const unnamed = all.filter((el) => !named.has(el)).map((el) => el.outerHTML.slice(0, 160));
      expect(unnamed, `${area}: ${role}s without a name`).toEqual([]);
    }
    // Icon-only: shows an icon and no text. (Empty hit areas over visible text, like a row's toggle or a bar's fill, aren't.)
    const iconOnly = c.queryAllByRole("button").filter((b) => (b.textContent ?? "").trim() === "" && b.querySelector("svg"));
    const noTip = iconOnly.filter((b) => !b.closest(".ui-tooltip-anchor") && !b.getAttribute("title")).map((b) => b.outerHTML.slice(0, 160));
    expect(noTip, `${area}: icon-only buttons without a tooltip`).toEqual([]);
  });

  it.skipIf(NO_EXPLAIN.includes(area))("has an Explain button for its main figure, backed by a real query", async () => {
    if (area === "goals") resetCore(goalsFixture().data); // the core-flows fixture has no goals
    const { container } = await renderArea(area);
    const buttons = within(container).getAllByRole("button", { name: /^Explain .+ with the assistant$/ });
    expect(buttons.length).toBeGreaterThan(0);
    const heard: ExplainFigure[] = [];
    const on = (e: Event) => heard.push((e as CustomEvent<ExplainFigure>).detail);
    window.addEventListener(EXPLAIN_EVENT, on);
    try {
      act(() => fireEvent.click(buttons[0]!));
    } finally {
      window.removeEventListener(EXPLAIN_EVENT, on);
    }
    expect(heard).toHaveLength(1);
    const q = queryRegistry.get(heard[0]!.query);
    expect(q, heard[0]!.query).toBeDefined();
    const params = q!.params.parse(heard[0]!.params);
    const result = q!.run(coreData() as never, params, TODAY);
    if (heard[0]!.figureId) expect(Object.keys(result.figures)).toContain(heard[0]!.figureId);
  });
});

describe.each(AREAS)("%s window with no data at all (§15 empty states)", (area) => {
  it("loads, says what goes there and offers a next step", async () => {
    resetCore(emptyData());
    const { container } = await renderArea(area);
    // Something says what goes here (an empty state, or the assistant's ready-made prompts).
    const empties = container.querySelectorAll(".ui-empty");
    if (area === "assistant") {
      expect(within(container).getAllByRole("button").length).toBeGreaterThan(0);
      return;
    }
    // The Overview has no single empty state: each card says so, and "Add account" is the next step.
    if (area !== "overview") expect(empties.length, `${area} shows no empty state`).toBeGreaterThan(0);
    // …and the next step is offered: a button in an empty state, or an obvious "Add …" one.
    const nextStep = [...empties].some((e) => e.querySelector("button")) || within(container).queryAllByRole("button", { name: /^(Add|Create|Set up)/ }).length > 0;
    expect(nextStep, `${area} offers no next step`).toBe(true);
  });
});
