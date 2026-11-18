/**
 * §15 "no one-off colours in components": hex colours (and rgb()/hsl()
 * literals) may only appear in the token files. Everything else uses the
 * CSS variables or the `color` export of tokens.ts.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..");

/** Files allowed to define colours, relative to src/. */
const TOKEN_FILES = new Set([
  "ui/tokens.css",
  "ui/tokens.ts",
  // The ported pixel-art scene is artwork data, not UI styling.
  "shell/background/sceneParts.ts",
  "shell/background/palette.ts",
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(SRC)
  .map((p) => relative(SRC, p).split("\\").join("/"))
  .filter((p) => /\.(tsx?|css)$/.test(p) && !/\.test\.tsx?$/.test(p) && !TOKEN_FILES.has(p));

const HEX = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?\b/g;
const FUNC = /\b(?:rgba?|hsla?)\(\s*\d/g;

/** `#` used for things that aren't colours (URL fragments, selectors on ids) are written as `#id-…`; strip CSS id selectors and entity refs. */
function colourLiterals(text: string): string[] {
  const noComments = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  return [...(noComments.match(HEX) ?? []), ...(noComments.match(FUNC) ?? [])];
}

describe("no hex colours outside the token files", () => {
  it("scans a meaningful set of files", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files)("%s", (file) => {
    const found = colourLiterals(readFileSync(join(SRC, file), "utf8"));
    expect(found, `use a token from ui/tokens.css or ui/tokens.ts instead`).toEqual([]);
  });
});
