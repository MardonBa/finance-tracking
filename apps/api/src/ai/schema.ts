/**
 * zod → the `input_schema` of a Claude tool (§16).
 *
 * Claude accepts standard JSON Schema, so this is zod's own JSON Schema output
 * (input side, so defaulted fields are optional) with two small additions:
 * the top level is always an object, and fields whose format zod refinements
 * can't express (dates, months, cents) get a short description hint. The zod
 * schema still validates every call (harness.ts).
 */
import { z } from "zod";

export type JsonSchema = Record<string, unknown>;
export type InputSchema = { type: "object"; properties?: Record<string, unknown>; required?: string[]; [k: string]: unknown };

/** zod refinements (dates, months) don't survive JSON Schema; the field name says what they are. */
export function keyHint(key: string, node: JsonSchema): string | undefined {
  const types = Array.isArray(node.type) ? node.type : [node.type];
  if (types.includes("string") && !node.enum) {
    if (/^(from|to|date|since|until|asOf|today)$|Date$|On$/.test(key)) return "Date as YYYY-MM-DD.";
    if (/^(month|endMonth|startMonth)$/.test(key)) return "Month as YYYY-MM.";
  } else if ((types.includes("integer") || types.includes("number")) && /Cents$/.test(key)) {
    return "Whole cents ($1 = 100).";
  }
  return undefined;
}

function addHints(node: unknown, depth = 0): unknown {
  if (!node || typeof node !== "object" || depth > 20) return node;
  if (Array.isArray(node)) return node.map((n) => addHints(n, depth + 1));
  const out: JsonSchema = {};
  for (const [k, v] of Object.entries(node as JsonSchema)) out[k] = addHints(v, depth + 1);
  const props = out.properties as Record<string, JsonSchema> | undefined;
  if (props && typeof props === "object") {
    for (const [key, prop] of Object.entries(props)) {
      const hint = keyHint(key, prop);
      if (hint && !String(prop.description ?? "").includes(hint)) {
        props[key] = { ...prop, description: [hint, prop.description].filter(Boolean).join(" ") };
      }
    }
  }
  return out;
}

/** The tool `input_schema` for a zod schema (always an object at the top). */
export function toInputSchema(schema: z.ZodType): InputSchema {
  let json: JsonSchema;
  try {
    json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any", reused: "inline" }) as JsonSchema;
  } catch {
    return { type: "object", properties: {}, description: "Free-form input." };
  }
  delete json.$schema;
  const out = addHints(json) as JsonSchema;
  if (out.type !== "object") return { type: "object", properties: { value: out }, required: ["value"] };
  return out as InputSchema;
}
