/**
 * Worker bindings and secrets. Vars come from wrangler.toml per environment;
 * secrets come from .dev.vars locally (written by scripts/sync-dev-vars.mjs)
 * and from `wrangler secret put --env <env>` when deployed.
 */
export interface AppEnv {
  /** "dev" | "production" (wrangler.toml vars). */
  ENVIRONMENT: string;
  /** "sandbox" | "production" (wrangler.toml vars). */
  PLAID_ENV: string;
  /** IANA zone used to compute the user's "today". */
  USER_TIME_ZONE: string;
  /** This Worker's public base URL (no trailing slash): Plaid webhook and Hosted Link redirect page. */
  PUBLIC_API_URL: string;

  DB: D1Database;
  BACKUPS: R2Bucket;

  // ---- secrets
  PLAID_CLIENT_ID: string;
  PLAID_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GEMINI_API_KEY: string;
  /** Assistant model (wrangler.toml vars); default gemini-2.5-flash. */
  GEMINI_MODEL?: string;
  /** Used when the main model hits its quota; default gemini-2.5-flash-lite. */
  GEMINI_FALLBACK_MODEL?: string;
  /** Our own Gemini request budget (ai/rateLimit.ts); defaults match the free tier. */
  AI_RPM_LIMIT?: string;
  AI_RPD_LIMIT?: string;
  /** Only this Google account may sign in (subject id preferred, email as fallback). */
  ALLOWED_GOOGLE_SUB?: string;
  ALLOWED_GOOGLE_EMAIL?: string;
  /** base64 32-byte AES-GCM key for Plaid access tokens. */
  TOKEN_ENC_KEY: string;
  /** base64 32-byte AES-GCM key for R2 backups. */
  BACKUP_ENC_KEY: string;
  /** Secret pepper for hashing app tokens (HMAC-SHA256). */
  APP_TOKEN_PEPPER: string;
  /** Local-dev-only bearer token. Honoured ONLY when ENVIRONMENT is "dev"; ignored in production. */
  DEV_APP_TOKEN?: string;
}

declare global {
  namespace Cloudflare {
    interface Env extends AppEnv {}
  }
}

export type HonoEnv = { Bindings: AppEnv; Variables: { credentialId: string } };

/** A Worker deployed without --env has no DB binding; refuse to run rather than guess. */
export function assertConfigured(env: Partial<AppEnv>): asserts env is AppEnv {
  if (!env.DB || !env.ENVIRONMENT) throw new Error("Worker is not configured: deploy with --env dev or --env production");
}
