/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend base URL; defaults to the local `wrangler dev` server. */
  readonly VITE_API_URL?: string;
  /** Local-dev-only bearer token (written by scripts/sync-dev-vars.mjs). Ignored in production builds. */
  readonly VITE_DEV_APP_TOKEN?: string;
  /** "1" to skip Google sign-in and Touch ID in dev builds, using VITE_DEV_APP_TOKEN. */
  readonly VITE_DEV_AUTH_BYPASS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
