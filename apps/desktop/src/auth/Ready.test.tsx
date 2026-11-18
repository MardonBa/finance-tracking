// @vitest-environment jsdom
/**
 * §4 "right after Touch ID": once the gate unlocks (gate.ts → ready), Ready
 * mounts and asks for connection health; any bank that needs signing in
 * again, reported an error, or is about to expire is named in a prompt with
 * Reconnect (Plaid update mode). Healthy banks: no prompt.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { gateReducer } from "./gate.ts";
import { Ready } from "./Ready.tsx";
import type { ConnectionHealth } from "../connections/api.ts";

vi.mock("../shell/Shell.tsx", () => ({ Shell: () => <div data-testid="desktop" /> }));

const base: ConnectionHealth = {
  itemId: "item_ok",
  institutionName: "Good Bank",
  status: "ok",
  errorCode: null,
  message: "Good Bank is up to date",
  needsReconnect: false,
  lastUpdatedAt: "2026-11-18T06:00:00.000Z",
  lastUpdatedSource: "plaid",
  consentExpiresAt: null,
  importStatus: "up_to_date",
  syncing: false,
  refreshAvailableAt: null,
  accountCount: 2,
};

let health: ConnectionHealth[] = [];
const requests: Array<{ url: string; body: unknown }> = [];

beforeEach(() => {
  requests.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ url, body });
      const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
      if (url.endsWith("/connections")) return json({ items: health });
      if (url.endsWith("/connections/link")) return json({ sessionId: "ls_up", hostedLinkUrl: "https://secure.plaid.com/hl/up", expiresAt: "", mode: "update" });
      if (url.endsWith("/connections/finalize")) return json({ status: "pending", sessionId: "ls_up" });
      return json({});
    }),
  );
  vi.spyOn(window, "open").mockImplementation(() => null);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("reconnect prompt after unlock", () => {
  it("the gate reaches ready only after Touch ID, and Ready then prompts for the broken bank, naming it and the problem", async () => {
    const locked = gateReducer({ kind: "starting" }, { type: "started", hasCredential: true });
    expect(locked.kind).toBe("locked");
    const ready = gateReducer(locked, { type: "touchIdDone", token: "tok" });
    expect(ready).toEqual({ kind: "ready", token: "tok" });

    health = [
      base,
      { ...base, itemId: "item_chase", institutionName: "Chase", status: "login_required", errorCode: "ITEM_LOGIN_REQUIRED", message: "Chase needs you to sign in again", needsReconnect: true },
    ];
    render(<Ready token="tok" onSignedOut={() => undefined} />);
    const dialog = await screen.findByRole("dialog", { name: /Chase needs attention/ });
    expect(within(dialog).getByText(/Needs you to sign in again/)).toBeTruthy();
    expect(within(dialog).queryByText(/Good Bank/)).toBeNull();
    expect(requests.some((r) => r.url.endsWith("/connections"))).toBe(true);

    // Reconnect: Plaid update mode for that bank, opened in the system browser.
    fireEvent.click(within(dialog).getByRole("button", { name: "Reconnect" }));
    await waitFor(() => expect(requests.find((r) => r.url.endsWith("/connections/link"))?.body).toEqual({ itemId: "item_chase" }));
    await waitFor(() => expect(window.open).toHaveBeenCalledWith("https://secure.plaid.com/hl/up", "_blank", "noopener"));
    expect(await screen.findByRole("dialog", { name: "Reconnect Chase" })).toBeTruthy();
  });

  it("expiring consent and errors prompt too; 'Not now' dismisses", async () => {
    health = [
      { ...base, itemId: "a", institutionName: "Chase", status: "pending_expiration", needsReconnect: true, consentExpiresAt: "2026-11-22T00:00:00.000Z", message: "Chase access is about to expire" },
      { ...base, itemId: "b", institutionName: "Amex", status: "error", errorCode: "INTERNAL_SERVER_ERROR", message: "Amex reported an error" },
    ];
    render(<Ready token="tok" onSignedOut={() => undefined} />);
    const dialog = await screen.findByRole("dialog", { name: /2 banks need attention/ });
    expect(within(dialog).getByText(/Chase: Access ends/)).toBeTruthy();
    expect(within(dialog).getByText(/Amex: Reported an error/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("no prompt when every bank is healthy", async () => {
    health = [base];
    render(<Ready token="tok" onSignedOut={() => undefined} />);
    await waitFor(() => expect(requests.some((r) => r.url.endsWith("/connections"))).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("desktop")).toBeTruthy();
  });
});
