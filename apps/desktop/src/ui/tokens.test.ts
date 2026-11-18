import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { color } from "./tokens.ts";

const css = readFileSync(join(import.meta.dirname, "tokens.css"), "utf8");

function cssHexVars(): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{3,8})\s*;/gi)) out.set(m[1] as string, (m[2] as string).toLowerCase());
  return out;
}

describe("design tokens (§15)", () => {
  it("define the pixel-waves palette", () => {
    for (const hex of ["#efe6d0", "#f4ecd8", "#faf5e8", "#ffffff", "#1d4c9e", "#14233f", "#33435f", "#55627a"]) {
      expect(css.toLowerCase()).toContain(hex);
    }
  });

  it("include orange and pink shades", () => {
    expect(css).toMatch(/--orange-500:\s*#[0-9a-f]{6}/i);
    expect(css).toMatch(/--pink-500:\s*#[0-9a-f]{6}/i);
  });

  it("are light only", () => {
    expect(css).not.toMatch(/prefers-color-scheme:\s*dark/);
    expect(css).toMatch(/color-scheme:\s*light/);
  });

  it("tokens.ts mirrors tokens.css exactly", () => {
    const vars = cssHexVars();
    for (const [name, hex] of Object.entries(color)) {
      expect(vars.get(name), `--${name}`).toBe(hex);
    }
    for (const name of vars.keys()) {
      expect(Object.keys(color), `--${name} missing from tokens.ts`).toContain(name);
    }
  });

  it("collapse the raised shadow to zero when pressed", () => {
    expect(css).toMatch(/--raise-offset-pressed:\s*0px/);
  });
});
