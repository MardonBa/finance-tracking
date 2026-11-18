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
import type { GeminiSchema } from "../../src/ai/schema.ts";
import { BUILT_IN_PROMPTS } from "../../src/ai/prompts.ts";
import { createGeminiRestClient, GeminiRateLimitError, parseRetryDelay, type GenerateRequest } from "../../src/ai/gemini.ts";
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
    // Gemini function-name rules.
    for (const t of all) expect(t.name).toMatch(/^[a-zA-Z_][a-zA-Z0-9_.-]{0,63}$/);
    expect(new Set(all.map((t) => t.name)).size).toBe(all.length);
  });

  it("declares parameters Gemini accepts: top-level OBJECT, no OBJECT without properties, string enums", () => {
    const check = (s: GeminiSchema, path: string) => {
      if (s.type === "OBJECT") {
        expect(Object.keys(s.properties ?? {}).length, `${path} is an empty OBJECT`).toBeGreaterThan(0);
        for (const [k, v] of Object.entries(s.properties!)) check(v, `${path}.${k}`);
      }
      if (s.items) check(s.items, `${path}[]`);
      if (s.enum) for (const e of s.enum) expect(typeof e, path).toBe("string");
    };
    for (const d of declarations()) {
      expect(d.description.length).toBeGreaterThan(10);
      if (d.parameters) {
        expect(d.parameters.type, d.name).toBe("OBJECT");
        check(d.parameters, d.name);
      }
    }
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

describe("Gemini REST client (fake fetch, never the network)", () => {
  const req: GenerateRequest = { systemInstruction: { parts: [{ text: "s" }] }, contents: [{ role: "user", parts: [{ text: "hi" }] }], tools: [] };

  it("posts to generateContent with the key in a header, not the URL or body", async () => {
    let url = "";
    let init: RequestInit | undefined;
    const client = createGeminiRestClient("k-123", (async (u: string, i: RequestInit) => {
      url = u;
      init = i;
      return new Response(JSON.stringify({ candidates: [] }), { status: 200 });
    }) as unknown as typeof fetch);
    await client.generate("gemini-2.5-flash", req);
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
    expect((init!.headers as Record<string, string>)["x-goog-api-key"]).toBe("k-123");
    expect(url + String(init!.body)).not.toContain("k-123");
  });

  it("parses a 429's RetryInfo.retryDelay and daily quota", async () => {
    const body = {
      error: {
        code: 429,
        message: "You exceeded your current quota",
        status: "RESOURCE_EXHAUSTED",
        details: [
          { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] },
          { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "37s" },
        ],
      },
    };
    const client = createGeminiRestClient("k", (async () => new Response(JSON.stringify(body), { status: 429 })) as unknown as typeof fetch);
    const err = await client.generate("m", req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GeminiRateLimitError);
    expect(err).toMatchObject({ retryAfterMs: 37_000, perDay: true });
    expect(parseRetryDelay("1.5s")).toBe(1500);
    expect(parseRetryDelay("250ms")).toBe(250);
    expect(parseRetryDelay(undefined)).toBeNull();
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
    expect(importers(/ai\/gemini\.ts|from "\.\/gemini\.ts"/).filter((f) => !f.startsWith("ai/"))).toEqual([]);
    // Sync, webhooks, backups and the scheduled handler never reference the AI.
    for (const f of files(src).filter((f) => /\/(sync|backup|plaid|connections)\//.test(f))) {
      expect(readFileSync(f, "utf8"), relative(src, f)).not.toMatch(/runChat|\/ai\/|gemini/i);
    }
    const index = readFileSync(join(src, "index.ts"), "utf8");
    const scheduledPart = index.slice(index.indexOf("export async function runScheduled"));
    expect(scheduledPart).not.toMatch(/runChat|ai\//);
  });
});
