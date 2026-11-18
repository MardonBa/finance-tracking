/**
 * The assistant's tools come from the registries (§2, §16):
 * - every read tool is an existing visualization query (no AI-only or raw data access);
 * - every UI action has an assistant tool unless it's excluded with a reason (parity);
 * - nothing moves money.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { actionRegistry, queryRegistry } from "@ft/core";
import { AI_EXCLUDED, MONEY_MOVING, READ_PREFIX, WRITE_PREFIX, declarations, excludedReason, tools } from "../../src/ai/tools.ts";
import { BUILT_IN_PROMPTS } from "../../src/ai/prompts.ts";
import { createClaudeClient, ModelError, ModelRateLimitError, parseRetryAfter, type ModelRequest } from "../../src/ai/claude.ts";
import { forModel, accountLabels } from "../../src/ai/privacy.ts";

const { tools: all, byName } = tools();

describe("read tools = the query registry (§2 'The AI sees no more than the charts')", () => {
  it("maps every read tool to an existing registry query, and every query has one", () => {
    const reads = all.filter((t) => t.kind === "read");
    for (const t of reads) {
      expect(t.name.startsWith(READ_PREFIX)).toBe(true);
      expect(queryRegistry.get(t.query.name), t.name).toBe(t.query);
    }
    expect(reads.map((t) => (t.kind === "read" ? t.query.name : "")).sort()).toEqual(queryRegistry.names());
  });

  it("has only query tools and action-proposal tools: no raw table, SQL, bulk or export tool", () => {
    for (const t of all) {
      expect(["read", "write"]).toContain(t.kind);
      expect(t.name, t.name).not.toMatch(/export|dump|raw|sql|table|backup|bulk/i);
      if (t.kind === "write") expect(t.name.startsWith(WRITE_PREFIX)).toBe(true);
    }
    // Claude tool-name rules.
    for (const t of all) expect(t.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    expect(new Set(all.map((t) => t.name)).size).toBe(all.length);
  });

  it("declares input schemas Claude accepts: a JSON Schema object at the top, with hints for dates and cents", () => {
    for (const d of declarations()) {
      expect(d.description!.length, d.name).toBeGreaterThan(10);
      expect(d.input_schema.type, d.name).toBe("object");
      expect(JSON.stringify(d.input_schema), d.name).not.toContain("$schema");
    }
    const byCategory = declarations().find((d) => d.name === "q__spending__byCategory")!;
    const props = byCategory.input_schema.properties as Record<string, { description?: string }>;
    expect(props.from!.description).toContain("YYYY-MM-DD");
  });
});

describe("parity with manual entry (§16)", () => {
  it("every registry action (everything the UI can do) has an assistant tool, unless excluded with a reason", () => {
    const missing: string[] = [];
    for (const a of actionRegistry.all) {
      const tool = byName.get(`${WRITE_PREFIX}${a.name.replace(".", "__")}`);
      const reason = excludedReason(a);
      if (!tool && !reason) missing.push(a.name);
      if (tool && reason) missing.push(`${a.name} (excluded but still a tool)`);
      if (reason) expect(reason.length, a.name).toBeGreaterThan(10);
    }
    expect(missing).toEqual([]);
  });

  it("covers the §16 groups: budgets, goals, recategorising, rules, labels, splits, transfers, refunds, Poker, notes, manual accounts", () => {
    for (const name of [
      "budgets.create", "budgets.editPart", "goals.reorder", "goals.setDeadline", "goals.setContribution",
      "transactions.recategorise", "flows.deleteRule", "spending.setNecessityLabel", "transactions.split",
      "flows.markTransfer", "flows.linkRefund", "flows.markPoker", "transactions.setNote",
      "accounts.addManualAccount", "accounts.addManualTransaction",
    ]) {
      expect(byName.has(`${WRITE_PREFIX}${name.replace(".", "__")}`), name).toBe(true);
    }
  });

  it("excludes bank connections, sign-in/security and money movement, each with a reason", () => {
    const keys = Object.keys(AI_EXCLUDED);
    for (const k of ["ui:connections.link", "ui:connections.reconnect", "ui:connections.remove", "ui:auth.signIn", "ui:auth.touchId", "ui:moneyMovement"]) {
      expect(keys).toContain(k);
    }
    // No registry action touches bank connections or sign-in.
    for (const t of all) expect(t.name).not.toMatch(/connections__|auth__/);
    // Every excluded registry name really exists (the list doesn't rot).
    for (const k of keys.filter((k) => !k.startsWith("ui:"))) expect(actionRegistry.get(k), k).toBeDefined();
  });

  it("no action moves money (there should be none)", () => {
    expect(actionRegistry.all.filter((a) => MONEY_MOVING.test(a.name)).map((a) => a.name)).toEqual([]);
  });
});

describe("built-in prompts", () => {
  it("each names only tools that exist", () => {
    expect(BUILT_IN_PROMPTS).toHaveLength(3);
    for (const p of BUILT_IN_PROMPTS) {
      const named = p.guidance.match(/\b(q|propose)__\w+__\w+/g) ?? [];
      expect(named.length, p.id).toBeGreaterThan(0);
      for (const n of named) expect(byName.has(n), `${p.id}: ${n}`).toBe(true);
    }
    expect(BUILT_IN_PROMPTS.find((p) => p.id === "waste")!.guidance).toContain("q__goals__whatIf");
  });
});

describe("Claude client (fake fetch, never the network)", () => {
  const req: ModelRequest = { model: "claude-haiku-5-5", max_tokens: 100, messages: [{ role: "user", content: "hi" }] };
  const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  const errorBody = (type: string, message: string) => ({ type: "error", error: { type, message } });

  it("posts to the Messages API with the key in a header, not the URL or body", async () => {
    let url = "";
    let init: RequestInit | undefined;
    const client = createClaudeClient("k-123", (async (u: string | URL | Request, i?: RequestInit) => {
      url = String(u);
      init = i;
      return json({ id: "msg_1", type: "message", role: "assistant", model: "claude-haiku-5-5", content: [], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }, 200);
    }) as unknown as typeof fetch);
    await client.create(req);
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    // This SDK sends the API key as a bearer token.
    expect(new Headers(init!.headers).get("authorization")).toBe("Bearer k-123");
    expect(url + String(init!.body)).not.toContain("k-123");
  });

  it("maps a 429 to ModelRateLimitError with its retry-after", async () => {
    const client = createClaudeClient("k", (async () => json(errorBody("rate_limit_error", "slow down"), 429, { "retry-after": "37" })) as unknown as typeof fetch);
    const err = await client.create(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelRateLimitError);
    expect(err).toMatchObject({ retryAfterMs: 37_000 });
    expect(parseRetryAfter("1.5")).toBe(1500);
    expect(parseRetryAfter(undefined)).toBeNull();
  });

  it("maps an empty credit balance to a 'credits' error and a bad key to a 'config' error", async () => {
    const credits = createClaudeClient("k", (async () =>
      json(errorBody("invalid_request_error", "Your credit balance is too low to access the Anthropic API."), 400)) as unknown as typeof fetch);
    expect(await credits.create(req).catch((e: unknown) => e)).toMatchObject({ kind: "credits" });
    const badKey = createClaudeClient("k", (async () => json(errorBody("authentication_error", "invalid x-api-key"), 401)) as unknown as typeof fetch);
    const err = await badKey.create(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect(err).toMatchObject({ kind: "config", status: 401 });
  });
});

describe("tool results are bounded", () => {
  it("cuts long arrays and caps the size (no bulk dumps)", () => {
    const big = { points: Array.from({ length: 5000 }, (_, i) => ({ date: `2026-01-${i}`, cents: i })) };
    const out = forModel(big, accountLabels([]));
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(14_000);
    expect(JSON.stringify(out)).toContain("not shown");
  });
});

describe("the AI only runs when asked (decision 006)", () => {
  const src = join(import.meta.dirname, "../../src");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
    });

  it("only the /ai/chat route imports the harness, and only the app's router mounts it", () => {
    const importers = (pattern: RegExp) =>
      files(src)
        .filter((f) => pattern.test(readFileSync(f, "utf8")))
        .map((f) => relative(src, f))
        .sort();
    expect(importers(/from "\.\/harness\.ts"|ai\/harness/)).toEqual(["ai/route.ts"]);
    expect(importers(/ai\/route\.ts/)).toEqual(["index.ts"]);
    expect(importers(/ai\/claude\.ts|from "\.\/claude\.ts"|@anthropic-ai\/sdk/).filter((f) => !f.startsWith("ai/"))).toEqual([]);
    // Sync, webhooks, backups and the scheduled handler never reference the AI.
    for (const f of files(src).filter((f) => /\/(sync|backup|plaid|connections)\//.test(f))) {
      expect(readFileSync(f, "utf8"), relative(src, f)).not.toMatch(/runChat|\/ai\/|anthropic/i);
    }
    const index = readFileSync(join(src, "index.ts"), "utf8");
    const scheduledPart = index.slice(index.indexOf("export async function runScheduled"));
    expect(scheduledPart).not.toMatch(/runChat|ai\//);
  });
});
