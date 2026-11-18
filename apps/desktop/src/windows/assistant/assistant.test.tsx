// @vitest-environment happy-dom
/**
 * Assistant window (§16): chips, figure links → drill-down, proposals
 * approved/rejected one by one, the "What was sent" drawer, the action log,
 * the rate-limit message, and "Explain this". The API is faked; nothing here
 * talks to the backend or Gemini.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { DRILLDOWN_EVENT, type DrillDownRequest } from "../../data/drilldown.ts";
import { renderInWindow } from "../testing/render.tsx";
import type { ChatResponse } from "./api.ts";

const api = vi.hoisted(() => ({
  chat: vi.fn(),
  builtInPrompts: vi.fn(),
  approveProposal: vi.fn(),
  actionLog: vi.fn(),
  undoLogged: vi.fn(),
}));

vi.mock("./api.ts", async (orig) => {
  const real = await orig<typeof import("./api.ts")>();
  return { ...real, ...api };
});

import { AssistantWindow } from "./AssistantWindow.tsx";
import { RateLimitedError } from "./api.ts";
import { explainWithAssistant } from "./explain.ts";

const PROMPTS = [
  { id: "top-spending", label: "What am I spending the most on this month?" },
  { id: "cut-back", label: "Where can I cut back?" },
  { id: "waste", label: "Where is money going to waste that could go elsewhere?" },
];

function response(over: Partial<ChatResponse> = {}): ChatResponse {
  return {
    text: "Dining was **$412.50** [F2] this month, usual $380 [C1].\n- Groceries $250.00 [F3]",
    proposals: [],
    citations: {
      C1: { kind: "chart", query: "spending.categorySeries", params: { endMonth: "2026-11" } },
      F2: { kind: "figure", query: "spending.byCategory", params: { from: "2026-11-01", to: "2026-11-18" }, figureId: "byCategory.FOOD_AND_DRINK", cents: 41250, label: "Dining · November" },
      F3: { kind: "figure", query: "spending.byCategory", params: { from: "2026-11-01", to: "2026-11-18" }, figureId: "byCategory.GROCERIES", cents: 25000, label: null },
    },
    nextTag: 4,
    rounds: 1,
    model: "gemini-2.5-flash",
    usage: { promptTokens: 100, outputTokens: 20 },
    sent: {
      systemPrompt: "You are the assistant inside a personal finance app. UNTRUSTED TEXT …",
      tools: { count: 2, read: ["q__spending__byCategory"], write: ["propose__budgets__editPart"], declarationChars: 500 },
      requests: [
        { model: "gemini-2.5-flash", newContents: [{ role: "user", parts: [{ text: "What am I spending the most on this month?" }] }] },
        {
          model: "gemini-2.5-flash",
          newContents: [
            { role: "model", parts: [{ functionCall: { name: "q__spending__byCategory", args: { from: "2026-11-01" } } }] },
            { role: "user", parts: [{ functionResponse: { name: "q__spending__byCategory", response: { value: { totalCents: 66250 } } } }] },
          ],
        },
      ],
    },
    ...over,
  };
}

const twoProposals = (): ChatResponse =>
  response({
    text: "Clothes has been under plan; I've proposed two changes.",
    citations: {},
    proposals: [
      {
        id: "p1",
        action: "budgets.editPart",
        input: { partId: "part_clothes", expectedCents: 18000 },
        preview: { summary: "Lower Clothes to $180.00", changes: [{ label: "Expected", before: "$300.00", after: "$180.00" }] },
      },
      {
        id: "p2",
        action: "goals.setContribution",
        input: { goalId: "goal_dgx", expectedContributionCents: 42000, contributionPeriod: "monthly" },
        preview: { summary: "Raise DGX Spark to $420.00/month", changes: [{ label: "Contribution", before: "$300.00/month", after: "$420.00/month" }] },
      },
    ],
  });

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.builtInPrompts.mockResolvedValue(PROMPTS);
  api.actionLog.mockResolvedValue([]);
  api.chat.mockResolvedValue(response());
  api.approveProposal.mockResolvedValue({ logId: "log1", preview: { summary: "", changes: [] } });
  api.undoLogged.mockResolvedValue({ undone: "log1" });
});
afterEach(() => cleanup());

async function renderAssistant() {
  renderInWindow(<AssistantWindow />, "assistant");
  await screen.findByRole("button", { name: PROMPTS[0]!.label });
}

describe("AssistantWindow", () => {
  it("says it only runs when asked and sends nothing until then", async () => {
    await renderAssistant();
    expect(screen.getByText(/Runs only when you ask/)).toBeTruthy();
    expect(api.chat).not.toHaveBeenCalled();
  });

  it("built-in prompts are one-click chips that ask with their prompt id", async () => {
    await renderAssistant();
    for (const p of PROMPTS) expect(screen.getByRole("button", { name: p.label })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Where can I cut back?" }));
    await waitFor(() => expect(api.chat).toHaveBeenCalledTimes(1));
    const [, body] = api.chat.mock.calls[0]!;
    expect(body).toMatchObject({ promptId: "cut-back", firstTag: 1, messages: [{ role: "user", text: "Where can I cut back?" }] });
    await screen.findByText(/Dining was/);
  });

  it("sends the whole conversation (from memory) on the next turn", async () => {
    await renderAssistant();
    fireEvent.click(screen.getByRole("button", { name: PROMPTS[0]!.label }));
    await screen.findByText(/Dining was/);
    fireEvent.change(screen.getByLabelText("Ask the assistant"), { target: { value: "And last month?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(api.chat).toHaveBeenCalledTimes(2));
    expect(api.chat.mock.calls[1]![1]).toMatchObject({
      firstTag: 4,
      messages: [
        { role: "user", text: PROMPTS[0]!.label },
        { role: "assistant", text: expect.stringContaining("Dining was") },
        { role: "user", text: "And last month?" },
      ],
    });
  });

  it("each cited figure links to its drill-down with the cited query, params and figure id", async () => {
    const seen: DrillDownRequest[] = [];
    const onDrill = (e: Event) => seen.push((e as CustomEvent<DrillDownRequest>).detail);
    window.addEventListener(DRILLDOWN_EVENT, onDrill);
    await renderAssistant();
    fireEvent.click(screen.getByRole("button", { name: PROMPTS[0]!.label }));
    fireEvent.click(await screen.findByRole("button", { name: "Show transactions: Dining · November" }));
    expect(seen).toEqual([
      { query: "spending.byCategory", params: { from: "2026-11-01", to: "2026-11-18" }, figureId: "byCategory.FOOD_AND_DRINK", label: "Dining · November" },
    ]);
    // A figure without a label still links; a chart tag opens the chart's window.
    expect(screen.getByRole("button", { name: /Show transactions: spending.byCategory · byCategory.GROCERIES/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open the chart (spending.categorySeries)" })).toBeTruthy();
    // Tags never show as raw text.
    expect(screen.queryByText(/\[F2\]/)).toBeNull();
    window.removeEventListener(DRILLDOWN_EVENT, onDrill);
  });

  it("proposals are approved or rejected one by one; approve goes through the action route", async () => {
    api.chat.mockResolvedValue(twoProposals());
    await renderAssistant();
    fireEvent.click(screen.getByRole("button", { name: PROMPTS[2]!.label }));
    const first = await screen.findByRole("group", { name: "Proposed change: Lower Clothes to $180.00" });
    const second = screen.getByRole("group", { name: "Proposed change: Raise DGX Spark to $420.00/month" });
    expect(within(first).getByText("$300.00")).toBeTruthy();
    expect(within(first).getByText("$180.00")).toBeTruthy();
    expect(api.approveProposal).not.toHaveBeenCalled(); // nothing applied by showing it

    fireEvent.click(within(first).getByRole("button", { name: "Approve" }));
    await within(first).findByText("Applied");
    expect(api.approveProposal).toHaveBeenCalledTimes(1);
    expect(api.approveProposal.mock.calls[0]![1]).toMatchObject({ action: "budgets.editPart", input: { partId: "part_clothes", expectedCents: 18000 } });
    // The second is still waiting.
    expect(within(second).getByRole("button", { name: "Approve" })).toBeTruthy();

    fireEvent.click(within(second).getByRole("button", { name: "Reject" }));
    expect(within(second).getByText(/Rejected: nothing changed/)).toBeTruthy();
    expect(api.approveProposal).toHaveBeenCalledTimes(1);

    // Undo the applied one from its card.
    fireEvent.click(within(first).getByRole("button", { name: "Undo" }));
    await within(first).findByText("Undone");
    expect(api.undoLogged).toHaveBeenCalledWith("test-token", "log1");
  });

  it("shows an error on a proposal that fails to apply and keeps it approvable", async () => {
    api.chat.mockResolvedValue(twoProposals());
    api.approveProposal.mockRejectedValueOnce(new Error(JSON.stringify({ error: "That budget part no longer exists" })));
    await renderAssistant();
    fireEvent.click(screen.getByRole("button", { name: PROMPTS[2]!.label }));
    const first = await screen.findByRole("group", { name: "Proposed change: Lower Clothes to $180.00" });
    fireEvent.click(within(first).getByRole("button", { name: "Approve" }));
    expect(await within(first).findByText(/no longer exists/)).toBeTruthy();
    expect(within(first).getByRole("button", { name: "Approve" })).toBeTruthy();
  });

  it("the What was sent drawer shows exactly what went to Gemini", async () => {
    await renderAssistant();
    fireEvent.click(screen.getByRole("button", { name: "What was sent" }));
    expect(screen.getByText(/Nothing yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: PROMPTS[0]!.label }));
    await screen.findByText(/Dining was/);
    const drawer = screen.getByRole("region", { name: "What was sent" });
    expect(within(drawer).getByText(/UNTRUSTED TEXT/)).toBeTruthy();
    expect(within(drawer).getByText(/2 requests/)).toBeTruthy();
    expect(within(drawer).getByText(/q__spending__byCategory → /)).toBeTruthy();
    expect(within(drawer).getByText(/"totalCents": 66250/)).toBeTruthy();
    expect(within(drawer).getByText(/Tools offered \(2: 1 read, 1 propose\)/)).toBeTruthy();
  });

  it("shows a friendly message with when it can be used again when rate-limited", async () => {
    const retryAt = new Date(Date.now() + 45_000).toISOString();
    api.chat.mockRejectedValue(new RateLimitedError("limited", retryAt, "minute"));
    await renderAssistant();
    fireEvent.click(screen.getByRole("button", { name: PROMPTS[1]!.label }));
    const msg = await screen.findByRole("status");
    expect(msg.textContent).toMatch(/free allowance for this minute/);
    expect(msg.textContent).toContain(new Date(retryAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    expect(msg.textContent).toMatch(/Everything else in the app keeps working/);
    // The question goes back in the box to try again later.
    expect((screen.getByLabelText("Ask the assistant") as HTMLTextAreaElement).value).toBe(PROMPTS[1]!.label);
  });

  it("the action log lists applied changes with Undo", async () => {
    api.actionLog.mockResolvedValue([
      { id: "log9", actionName: "budgets.editPart", summary: "Lower Clothes to $180.00", source: "ai", appliedAt: "2026-11-18T10:00:00.000Z", undoneAt: null },
      { id: "log8", actionName: "transactions.setNote", summary: "Note on Costco", source: "user", appliedAt: "2026-11-17T10:00:00.000Z", undoneAt: "2026-11-17T11:00:00.000Z" },
    ]);
    await renderAssistant();
    fireEvent.click(screen.getByRole("button", { name: "Action log" }));
    const panel = screen.getByRole("region", { name: "Action log" });
    await within(panel).findByText("Lower Clothes to $180.00");
    expect(within(panel).getByText("Assistant")).toBeTruthy();
    expect(within(panel).getByText("Undone")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Undo: Lower Clothes to $180.00" }));
    await waitFor(() => expect(api.undoLogged).toHaveBeenCalledWith("test-token", "log9"));
  });

  it("keeps nothing in browser storage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    await renderAssistant();
    fireEvent.click(screen.getByRole("button", { name: PROMPTS[0]!.label }));
    await screen.findByText(/Dining was/);
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it('"Explain this" opens the assistant and asks about that figure', async () => {
    await renderAssistant();
    act(() => explainWithAssistant({ query: "spending.monthlySummary", params: { month: "2026-11", usualMonths: 3 }, figureId: "spending", label: "Spending · Nov" }));
    await waitFor(() => expect(api.chat).toHaveBeenCalledTimes(1));
    expect(api.chat.mock.calls[0]![1]).toMatchObject({
      messages: [{ role: "user", text: "Explain this: Spending · Nov" }],
      explain: { query: "spending.monthlySummary", params: { month: "2026-11", usualMonths: 3 }, figureId: "spending" },
    });
  });
});
