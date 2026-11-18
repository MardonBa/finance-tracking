/**
 * Test-only in-memory backend: runs the REAL core registry queries and
 * actions against a core fixture, the same way the API does, so window tests
 * see real query outputs. Not imported by the app.
 */
import type { ReactNode } from "react";
import {
  actionRegistry,
  applyMutations,
  inverseMutations,
  queryRegistry,
  type ActionContext,
  type CoreData,
  type Mutation,
} from "@ft/core";
import { AppTokenContext } from "../../../shell/context.ts";

export interface FakeBackend {
  data: CoreData;
  today: string;
  calls: { kind: "query" | "preview" | "action" | "undo"; name: string; input: unknown }[];
  runQuery(token: string, name: string, params: unknown): Promise<{ value: unknown; figures: Record<string, { cents: number }> }>;
  previewAction(token: string, name: string, input: unknown): Promise<{ preview: unknown }>;
  runAction(token: string, name: string, input: unknown): Promise<{ logId: string; preview: unknown }>;
  undoAction(token: string, logId: string): Promise<{ undone: string }>;
  actions(name: string): unknown[];
  queries(name: string): unknown[];
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function createFakeBackend(fixture: { data: CoreData; today: string }): FakeBackend {
  let n = 0;
  const undo = new Map<string, Mutation[]>();
  const ctx = (): ActionContext => ({ today: be.today, now: `${be.today}T12:00:00.000Z`, newId: () => `new_${++n}` });
  const be: FakeBackend = {
    data: fixture.data,
    today: fixture.today,
    calls: [],
    async runQuery(_t, name, params) {
      be.calls.push({ kind: "query", name, input: params });
      const q = queryRegistry.get(name);
      if (!q) throw new Error(`Unknown query ${name}`);
      return clone(q.run(be.data as never, q.params.parse(params ?? {}), be.today));
    },
    async previewAction(_t, name, input) {
      be.calls.push({ kind: "preview", name, input });
      const a = actionRegistry.get(name)!;
      return { preview: clone(a.describe(be.data as never, a.input.parse(input), ctx())) };
    },
    async runAction(_t, name, input) {
      be.calls.push({ kind: "action", name, input });
      const a = actionRegistry.get(name)!;
      const parsed = a.input.parse(input);
      const preview = a.describe(be.data as never, parsed, ctx());
      const muts = a.apply(be.data as never, parsed, ctx());
      const inv = a.inverse ? a.inverse(be.data as never, parsed, muts) : inverseMutations(be.data, muts);
      be.data = applyMutations(be.data, muts);
      const logId = `log_${++n}`;
      undo.set(logId, inv);
      return { logId, preview: clone(preview) };
    },
    async undoAction(_t, logId) {
      be.calls.push({ kind: "undo", name: logId, input: null });
      be.data = applyMutations(be.data, undo.get(logId) ?? []);
      return { undone: logId };
    },
    actions: (name) => be.calls.filter((c) => c.kind === "action" && c.name === name).map((c) => c.input),
    queries: (name) => be.calls.filter((c) => c.kind === "query" && c.name === name).map((c) => c.input),
  };
  return be;
}

export function WithToken({ children }: { children: ReactNode }) {
  return <AppTokenContext.Provider value="test-token">{children}</AppTokenContext.Provider>;
}
