#!/usr/bin/env node
// Generates the app's own secrets into the root .env if they are missing.
// Existing values are never replaced (rotating TOKEN_ENC_KEY would make
// stored Plaid tokens unreadable). Prints key names only, never values.
import { randomBytes } from "node:crypto";
import { ROOT_ENV, readEnvFile, setEnvKeys } from "./lib/env-file.mjs";

const GENERATED = {
  // AES-GCM 256 key for Plaid access tokens stored in D1 (§2).
  TOKEN_ENC_KEY: () => randomBytes(32).toString("base64"),
  // AES-GCM 256 key for encrypted R2 backups (§2).
  BACKUP_ENC_KEY: () => randomBytes(32).toString("base64"),
  // HMAC pepper for hashing app tokens (§2).
  APP_TOKEN_PEPPER: () => randomBytes(32).toString("base64url"),
  // Local-dev-only bearer token; reset:dev registers its hash in the local D1.
  DEV_APP_TOKEN: () => `dev_${randomBytes(32).toString("base64url")}`,
};

export function genSecrets({ quiet = false } = {}) {
  const env = readEnvFile();
  const missing = Object.keys(GENERATED).filter((k) => !env[k]);
  if (missing.length > 0) {
    setEnvKeys(ROOT_ENV, Object.fromEntries(missing.map((k) => [k, GENERATED[k]()])));
  }
  if (!quiet) {
    console.log(missing.length ? `Generated into .env: ${missing.join(", ")}` : "All generated secrets already present in .env");
  }
  return missing;
}

if (import.meta.url === `file://${process.argv[1]}`) genSecrets();
