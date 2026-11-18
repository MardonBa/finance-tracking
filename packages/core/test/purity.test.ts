/**
 * Purity rule (§1): code in packages/core/src must not read the clock, the
 * network or randomness. "Today", the current instant and id generators are
 * passed in. This test walks the TypeScript AST of every source file.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..", "src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

const BANNED_CALLS = new Set(["Date.now", "Math.random", "performance.now", "crypto.randomUUID", "crypto.getRandomValues"]);
const BANNED_GLOBALS = new Set(["fetch", "XMLHttpRequest", "WebSocket", "setTimeout", "setInterval"]);

export function findViolations(source: string, fileName = "x.ts"): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true);
  const out: string[] = [];
  const where = (n: ts.Node) => `${fileName}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node)) {
      const text = node.getText(sf).replace(/^globalThis\./, "");
      if (BANNED_CALLS.has(text)) out.push(`${where(node)} uses ${text}`);
      if (/^(globalThis|window|self)\.fetch$/.test(node.getText(sf))) out.push(`${where(node)} uses fetch`);
    }
    if (ts.isNewExpression(node) && node.expression.getText(sf).replace(/^globalThis\./, "") === "Date") {
      if (!node.arguments || node.arguments.length === 0) out.push(`${where(node)} uses new Date() without an argument`);
    }
    if (ts.isCallExpression(node) && node.expression.getText(sf).replace(/^globalThis\./, "") === "Date") {
      out.push(`${where(node)} calls Date() (reads the clock)`);
    }
    if (ts.isIdentifier(node) && BANNED_GLOBALS.has(node.text)) {
      const parent = node.parent;
      const isPropertyName = parent && ts.isPropertyAccessExpression(parent) && parent.name === node;
      const isDeclName =
        parent && (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isMethodDeclaration(parent)) && parent.name === node;
      if (!isPropertyName && !isDeclName) out.push(`${where(node)} uses ${node.text}`);
    }
    if (ts.isImportDeclaration(node)) {
      const mod = (node.moduleSpecifier as ts.StringLiteral).text;
      if (/^(node:)?(fs|net|http|https|child_process|crypto)$/.test(mod)) out.push(`${where(node)} imports ${mod}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe("packages/core purity", () => {
  it("the checker catches every banned pattern", () => {
    const bad = `
      const a = Date.now();
      const b = new Date();
      const b2 = new globalThis.Date;
      const c = Math.random();
      const d = fetch("x");
      const e = globalThis.fetch;
      const f = Date();
      import fs from "node:fs";
    `;
    expect(findViolations(bad)).toHaveLength(8);
    const ok = `
      const a = new Date(0);
      const b = Date.UTC(2026, 0, 1);
      const o = { fetch: 1 };
      o.fetch;
      const mathy = Math.round(1.5);
    `;
    expect(findViolations(ok)).toEqual([]);
  });

  it("no source file reads the clock, the network or randomness", () => {
    const all = files(SRC);
    expect(all.length).toBeGreaterThan(5);
    const violations = all.flatMap((f) => findViolations(readFileSync(f, "utf8"), relative(SRC, f)));
    expect(violations).toEqual([]);
  });
});
