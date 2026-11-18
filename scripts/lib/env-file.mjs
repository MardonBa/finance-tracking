// Tiny .env reader/writer. Never logs values.
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const ROOT_ENV = join(ROOT, ".env");

/** Parse KEY=VALUE lines (no interpolation). Quotes around values are removed. */
export function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

export function readEnvFile(path = ROOT_ENV) {
  return existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {};
}

/** Set keys in an env file, keeping other lines and comments as they are. */
export function setEnvKeys(path, values) {
  let text = existsSync(path) ? readFileSync(path, "utf8") : "";
  for (const [key, value] of Object.entries(values)) {
    const re = new RegExp(`^\\s*${key}\\s*=.*$`, "m");
    if (re.test(text)) text = text.replace(re, `${key}=${value}`);
    else text = `${text}${text === "" || text.endsWith("\n") ? "" : "\n"}${key}=${value}\n`;
  }
  writeFileSync(path, text, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** Write a whole KEY=VALUE file with owner-only permissions. */
export function writeEnvFile(path, values, header) {
  const lines = header ? header.split("\n").map((l) => `# ${l}`) : [];
  for (const [k, v] of Object.entries(values)) lines.push(`${k}=${v}`);
  writeFileSync(path, `${lines.join("\n")}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}
