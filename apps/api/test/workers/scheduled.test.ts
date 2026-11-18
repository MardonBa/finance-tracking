import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker, { runScheduled } from "../../src/index.ts";

describe("scheduled()", () => {
  it("computes the user's today from the scheduled time", async () => {
    // 03:30 UTC on Nov 18 is still Nov 17 in New York.
    expect((await runScheduled(env, Date.UTC(2026, 10, 18, 3, 30))).today).toBe("2026-11-17");
  });

  it("runs the daily job through the exported handler (no banks: nothing to sync)", async () => {
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ scheduledTime: Date.UTC(2026, 10, 18, 11), cron: "0 11 * * *" }), env, ctx);
    await waitOnExecutionContext(ctx);
  });
});
