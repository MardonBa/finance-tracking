import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(import.meta.dirname, "tokens.css"), "utf8");

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
});
