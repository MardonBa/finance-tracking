import { defineConfig } from "drizzle-kit";

// Only generates SQL from the schema; migrations are applied with
// `wrangler d1 migrations apply DB --env <env>` (see package.json and docs/shipping.md).
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./migrations",
});
