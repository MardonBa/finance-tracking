/**
 * Test double for api/client.ts that answers with REAL core outputs: every
 * query and action runs from the registry against an in-memory copy of the
 * core-flows fixture (@ft/core/fixtures), exactly as the Worker would.
 * Used only by window tests (vi.mock("../../api/client.ts", …)).
 */
import { actionRegistry, applyMutations, queryRegistry, type ActionContext, type CoreData } from "@ft/core";
import { flowsFixture } from "@ft/core/fixtures";

export const TODAY = flowsFixture().today;

let data: CoreData = flowsFixture().data;
let n = 0;
const history = new Map<string, CoreData>();

export const calls: { kind: "query" | "action" | "preview" | "undo"; name: string; params: unknown }[] = [];

export function resetCore(next?: CoreData): void {
  data = next ?? flowsFixture().data;
  calls.length = 0;
  history.clear();
}

export function coreData(): CoreData {
  return data;
}

function ctx(): ActionContext {
  return { today: TODAY, now: `${TODAY}T12:00:00.000Z`, newId: () => `test_${++n}` };
}

/** Runs a registry query the way the API does (params parsed, JSON round trip). */
export function runCoreQuery<V = unknown>(name: string, params: unknown) {
  const q = queryRegistry.get(name);
  if (!q) throw new Error(`Unknown query ${name}`);
  const result = q.run(data as never, q.params.parse(params ?? {}), TODAY);
  return JSON.parse(JSON.stringify(result)) as { value: V; figures: Record<string, { cents: number; contributions: { transactionId: string; cents: number }[]; label?: string }> };
}

export const clientMock = {
  API_URL: "http://test",
  DEV_APP_TOKEN: undefined,
  ApiError: class ApiError extends Error {
    status = 400;
  },
  setUnauthorizedHandler() {},
  async revokeCredential() {
    return { revoked: 0 };
  },
  async runQuery(_token: string, name: string, params: unknown) {
    calls.push({ kind: "query", name, params });
    return runCoreQuery(name, params);
  },
  async previewAction(_token: string, name: string, input: unknown) {
    calls.push({ kind: "preview", name, params: input });
    const a = actionRegistry.get(name)!;
    return { preview: a.describe(data as never, a.input.parse(input), ctx()) };
  },
  async runAction(_token: string, name: string, input: unknown) {
    calls.push({ kind: "action", name, params: input });
    const a = actionRegistry.get(name)!;
    const parsed = a.input.parse(input);
    const c = ctx();
    const preview = a.describe(data as never, parsed, c);
    const logId = `log_${++n}`;
    history.set(logId, data);
    data = applyMutations(data, a.apply(data as never, parsed, c));
    return { logId, preview };
  },
  async undoAction(_token: string, logId: string) {
    calls.push({ kind: "undo", name: logId, params: null });
    const before = history.get(logId);
    if (before) data = before;
    return { undone: logId };
  },
};
