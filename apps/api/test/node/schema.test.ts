import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { PRIMARY_KEYS, type DataKey } from "@ft/core";
import * as schema from "../../src/db/schema.ts";
import { TABLES } from "../../src/db/tables.ts";

const SCHEMA_PATH = join(import.meta.dirname, "../../src/db/schema.ts");
const source = readFileSync(SCHEMA_PATH, "utf8");

/** Every column property inside a sqliteTable(...) call, with the text that follows it on its line. */
function columnsWithTrailingText() {
  const sf = ts.createSourceFile("schema.ts", source, ts.ScriptTarget.ES2022, true);
  const out: Array<{ table: string; column: string; trailing: string }> = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(sf) === "sqliteTable") {
      const [nameArg, colsArg] = node.arguments;
      if (nameArg && colsArg && ts.isStringLiteral(nameArg) && ts.isObjectLiteralExpression(colsArg)) {
        for (const prop of colsArg.properties) {
          const lineEnd = source.indexOf("\n", prop.end);
          out.push({ table: nameArg.text, column: prop.name?.getText(sf) ?? "?", trailing: source.slice(prop.end, lineEnd) });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const allTables = (Object.values(schema) as unknown[]).filter((v): v is SQLiteTable => typeof v === "object" && v !== null && "getSQL" in v);

describe("D1 schema rules (§2)", () => {
  it("every column has a comment giving the reason it is stored", () => {
    const cols = columnsWithTrailingText();
    expect(cols.length).toBeGreaterThan(150);
    const missing = cols.filter((c) => !/^,?\s*\/\/\s*\S.{9,}/.test(c.trailing)).map((c) => `${c.table}.${c.column}`);
    expect(missing).toEqual([]);
  });

  it("the comment check sees every column drizzle knows about", () => {
    const parsed = columnsWithTrailingText().length;
    const actual = allTables.reduce((n, t) => n + Object.keys(getTableColumns(t)).length, 0);
    expect(parsed).toBe(actual);
  });

  it("never stores account/routing numbers, owner identity or location", () => {
    const forbidden =
      /(account_number|acct_num|routing|wire_routing|\biban\b|bic|sort_code|owner|holder_name|full_name|first_name|last_name|address|street|city|region|postal|zip|country|phone|email|location|latitude|longitude|lat$|lon$|store_number|ssn|tax_id|date_of_birth)/i;
    const names = allTables.flatMap((t) => getTableConfig(t).columns.map((c) => `${getTableConfig(t).name}.${c.name}`));
    expect(names.filter((n) => forbidden.test(n.split(".")[1]!))).toEqual([]);
  });

  it("primary keys in D1 match @ft/core PRIMARY_KEYS for every slice", () => {
    for (const [slice, table] of Object.entries(TABLES) as Array<[DataKey, SQLiteTable]>) {
      const config = getTableConfig(table);
      const cols = getTableColumns(table) as Record<string, { name: string; primary: boolean }>;
      const byDbName = new Map(Object.entries(cols).map(([prop, c]) => [c.name, prop]));
      const single = Object.entries(cols).filter(([, c]) => c.primary).map(([prop]) => prop);
      const composite = config.primaryKeys.flatMap((pk) => pk.columns.map((c) => byDbName.get(c.name)!));
      expect([...single, ...composite].sort(), slice).toEqual([...PRIMARY_KEYS[slice]].sort());
    }
  });

  it("the committed migrations are up to date with schema.ts", () => {
    const journal = JSON.parse(readFileSync(join(import.meta.dirname, "../../migrations/meta/_journal.json"), "utf8")) as {
      entries: Array<{ tag: string }>;
    };
    const last = journal.entries.at(-1)!.tag;
    const snapshot = JSON.parse(
      readFileSync(join(import.meta.dirname, `../../migrations/meta/${last.split("_")[0]}_snapshot.json`), "utf8"),
    ) as { tables: Record<string, { columns: Record<string, unknown> }> };
    for (const t of allTables) {
      const cfg = getTableConfig(t);
      const snapCols = Object.keys(snapshot.tables[cfg.name]?.columns ?? {}).sort();
      expect(snapCols, `${cfg.name}: run npm run db:generate -w @ft/api`).toEqual(cfg.columns.map((c) => c.name).sort());
    }
    expect(Object.keys(snapshot.tables).sort()).toEqual(allTables.map((t) => getTableConfig(t).name).sort());
  });
});
