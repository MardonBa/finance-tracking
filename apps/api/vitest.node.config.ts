// Static and pure tests that run in Node: schema rules, Plaid allowlist,
// response schemas and trimming against saved fixtures.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/node/**/*.test.ts"],
  },
});
