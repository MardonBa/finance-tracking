/**
 * Registry-driven routes:
 *   GET  /q/:name?params=<json>   run a query (params as URL-encoded JSON)
 *   POST /q/:name                 run a query (params as JSON body)
 *   POST /a/:name/preview         describe an action (before → after), changes nothing
 *   POST /a/:name                 apply an action; logged in action_log
 *   GET  /actions                 recent action log
 *   POST /actions/:id/undo        undo a logged action
 */
import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  ActionError,
  actionRegistry,
  inverseMutations,
  isoDateInTimeZone,
  queryRegistry,
  type ActionContext,
  type ActionPreview,
  type ActionSource,
  type Mutation,
} from "@ft/core";
import type { AppEnv, HonoEnv } from "../env.ts";
import { getDb, loadSlices, mutationStatements } from "../db/data.ts";
import { actionLog } from "../db/schema.ts";

export function todayFor(env: Pick<AppEnv, "USER_TIME_ZONE">, nowMs: number): string {
  return isoDateInTimeZone(nowMs, env.USER_TIME_ZONE || "UTC");
}

function actionContext(env: AppEnv): ActionContext {
  const nowMs = Date.now();
  return { today: todayFor(env, nowMs), now: new Date(nowMs).toISOString(), newId: () => crypto.randomUUID() };
}

export class NotFound extends Error {}

export async function runQuery(env: AppEnv, name: string, rawParams: unknown) {
  const q = queryRegistry.get(name);
  if (!q) throw new NotFound(`No query "${name}"`);
  const params = q.params.parse(rawParams);
  const data = await loadSlices(getDb(env.DB), q.needs);
  return q.run(data, params, todayFor(env, Date.now()));
}

export async function previewAction(env: AppEnv, name: string, rawInput: unknown): Promise<ActionPreview> {
  const a = actionRegistry.get(name);
  if (!a) throw new NotFound(`No action "${name}"`);
  const input = a.input.parse(rawInput);
  const data = await loadSlices(getDb(env.DB), a.needs);
  return a.describe(data, input, actionContext(env));
}

/**
 * Apply an action and log it, atomically. Used by the /a route (source
 * "user") and by the AI harness after the user approves (source "ai").
 */
export async function applyAction(env: AppEnv, name: string, rawInput: unknown, source: ActionSource) {
  const a = actionRegistry.get(name);
  if (!a) throw new NotFound(`No action "${name}"`);
  const input = a.input.parse(rawInput);
  const db = getDb(env.DB);
  const before = await loadSlices(db, a.needs);
  const ctx = actionContext(env);
  const preview = a.describe(before, input, ctx);
  const mutations = a.apply(before, input, ctx);
  const inverse = a.inverse ? a.inverse(before, input, mutations) : inverseMutations(before, mutations);
  const logId = ctx.newId();
  const log = db.insert(actionLog).values({
    id: logId,
    actionName: name,
    inputJson: JSON.stringify(input),
    summary: preview.summary,
    mutationsJson: JSON.stringify(mutations),
    inverseJson: JSON.stringify(inverse),
    source,
    appliedAt: ctx.now,
    undoneAt: null,
  });
  await db.batch([log, ...mutationStatements(db, mutations)]);
  return { logId, preview };
}

export async function undoAction(env: AppEnv, logId: string) {
  const db = getDb(env.DB);
  const entry = await db.select().from(actionLog).where(eq(actionLog.id, logId)).get();
  if (!entry) throw new NotFound(`No action log entry "${logId}"`);
  if (entry.undoneAt) throw new ActionError("This change was already undone");
  // TODO(revisit): no conflict detection if a later action changed the same rows.
  const inverse = JSON.parse(entry.inverseJson) as Mutation[];
  const now = new Date().toISOString();
  await db.batch([
    db.update(actionLog).set({ undoneAt: now }).where(eq(actionLog.id, logId)),
    ...mutationStatements(db, inverse),
  ]);
  return { undone: logId };
}

export const registryRoutes = new Hono<HonoEnv>()
  .get("/q/:name", async (c) => {
    const raw = c.req.query("params");
    let params: unknown = {};
    if (raw) {
      try {
        params = JSON.parse(raw);
      } catch {
        return c.json({ error: "params must be URL-encoded JSON" }, 400);
      }
    }
    return c.json(await runQuery(c.env, c.req.param("name"), params));
  })
  .post("/q/:name", async (c) => c.json(await runQuery(c.env, c.req.param("name"), await readJson(c.req.raw))))
  .post("/a/:name/preview", async (c) =>
    c.json({ preview: await previewAction(c.env, c.req.param("name"), await readJson(c.req.raw)) }),
  )
  .post("/a/:name", async (c) => c.json(await applyAction(c.env, c.req.param("name"), await readJson(c.req.raw), "user")))
  .get("/actions", async (c) => {
    const limit = z.coerce.number().int().min(1).max(200).catch(50).parse(c.req.query("limit"));
    const rows = await getDb(c.env.DB)
      .select({
        id: actionLog.id,
        actionName: actionLog.actionName,
        summary: actionLog.summary,
        source: actionLog.source,
        appliedAt: actionLog.appliedAt,
        undoneAt: actionLog.undoneAt,
      })
      .from(actionLog)
      .orderBy(desc(actionLog.appliedAt))
      .limit(limit)
      .all();
    return c.json({ actions: rows });
  })
  .post("/actions/:id/undo", async (c) => c.json(await undoAction(c.env, c.req.param("id"))));

async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ActionError("Body must be JSON");
  }
}
