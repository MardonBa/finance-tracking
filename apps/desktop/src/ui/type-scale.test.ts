/**
 * §15 "a small set of text sizes": six sizes, defined once in tokens.css;
 * every font-size elsewhere uses one of them.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));

describe("type scale (§15)", () => {
  const tokens = readFileSync(join(SRC, "ui/tokens.css"), "utf8");
  const sizes = [...tokens.matchAll(/--text-(xs|sm|md|lg|xl|2xl):\s*(\d+)px/g)].map((m) => Number(m[2]));

  it("defines six text sizes, smallest to largest", () => {
    expect(sizes).toHaveLength(6);
    expect([...sizes].sort((a, b) => a - b)).toEqual(sizes);
  });

  it("every font-size outside the tokens uses a --text-* size", () => {
    const offenders: string[] = [];
    for (const p of walk(SRC).filter((f) => /\.css$/.test(f) && !f.endsWith("ui/tokens.css"))) {
      for (const m of readFileSync(p, "utf8").matchAll(/font-size:\s*([^;]+);/g)) {
        if (!/^var\(--text-(xs|sm|md|lg|xl|2xl)\)$/.test(m[1]!.trim()) && m[1]!.trim() !== "inherit") offenders.push(`${relative(SRC, p)}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
