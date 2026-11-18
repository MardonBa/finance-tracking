#!/usr/bin/env node
// Fails (exit 1) unless every named environment variable is set and non-empty.
// Used by `npm run ship:app` so the .app is never built against the wrong API.
// Prints only the names, never the values.
const missing = process.argv.slice(2).filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Set ${missing.join(", ")} first (see docs/shipping.md).`);
  process.exit(1);
}
