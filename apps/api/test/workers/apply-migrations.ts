// Every test starts from an empty, fully migrated local D1.
import { applyD1Migrations, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach } from "vitest";

beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
