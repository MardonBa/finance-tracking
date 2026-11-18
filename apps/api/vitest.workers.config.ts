// Integration tests that run inside the Workers runtime (Miniflare) against a
// local D1 with the real migrations applied. Secrets are fixed test values,
// never the developer's .dev.vars.
import { join } from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(join(import.meta.dirname, "migrations"));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.toml", environment: "dev" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            PLAID_CLIENT_ID: "test-client-id",
            PLAID_SECRET: "test-secret",
            GOOGLE_CLIENT_ID: "test-google-client",
            GOOGLE_CLIENT_SECRET: "test-google-secret",
            GEMINI_API_KEY: "test-gemini-key",
            ALLOWED_GOOGLE_SUB: "1234567890",
            ALLOWED_GOOGLE_EMAIL: "me@example.com",
            DEV_APP_TOKEN: "dev_test_token_aaaaaaaaaaaaaaaaaaaaaaaa",
            TOKEN_ENC_KEY: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
            BACKUP_ENC_KEY: "HxwdHh8QERITFBUWFxgZGhscAAECAwQFBgcICQoLDA0=",
            APP_TOKEN_PEPPER: "test-pepper",
          },
        },
      }),
    ],
    test: {
      include: ["test/workers/**/*.test.ts"],
      setupFiles: ["./test/workers/apply-migrations.ts"],
    },
  };
});
