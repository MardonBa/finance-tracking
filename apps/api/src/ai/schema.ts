/**
 * zod → Gemini function-declaration parameters (§16).
 *
 * Gemini accepts a subset of OpenAPI 3 schemas (type, properties, required,
 * items, enum of strings, nullable, description, minimum/maximum, min/maxItems).
 * We go through zod's own JSON Schema output (input side, so defaulted fields
 * are optional) and map it onto that subset. Anything Gemini can't express is
 * moved into the description; the zod schema still validates every call.
 */
import { z } from "zod";

export interface GeminiSchema {
  type: "STRING" | "NUMBER" | "INTEGER" | "BOOLEAN" | "ARRAY" | "OBJECT";
  description?: string;
  nullable?: boolean;
  enum?: string[];
  format?: string;
  properties?: Record<string, GeminiSchema>;
  required?: string[];
  items?: GeminiSchema;
  minimum?: number;
  maximum?: number;
  minItems?: string;
  maxItems?: string;
}

type Json = Record<string, unknown>;

const TYPE_MAP: Record<string, GeminiSchema["type"]> = {
  string: "STRING",
  number: "NUMBER",
  integer: "INTEGER",
  boolean: "BOOLEAN",
  array: "ARRAY",
  object: "OBJECT",
};

function note(parts: (string | undefined)[]): string | undefined {
  const s = parts.filter(Boolean).join(" ").trim();
  return s ? s.slice(0, 300) : undefined;
}

/** zod refinements (dates, months) don't survive JSON Schema; the field name says what they are. */
function withKeyHint(key: string, s: GeminiSchema): GeminiSchema {
  let hint: string | undefined;
  if (s.type === "STRING" && !s.enum) {
    if (/^(from|to|date|since|until|asOf|today)$|Date$|On$/.test(key)) hint = "Date as YYYY-MM-DD.";
    else if (/^(month|endMonth|startMonth)$/.test(key)) hint = "Month as YYYY-MM.";
  } else if ((s.type === "NUMBER" || s.type === "INTEGER") && /Cents$/.test(key)) {
    hint = "Whole cents ($1 = 100).";
  }
  if (!hint || s.description?.includes(hint)) return s;
  return { ...s, description: note([hint, s.description]) };
}

function convert(node: Json, defs: Record<string, Json>, depth: number): GeminiSchema {
  if (depth > 12) return { type: "OBJECT", description: "(nested value)" };
  if (typeof node.$ref === "string") {
    const key = node.$ref.replace(/^#\/(\$defs|definitions)\//, "");
    const target = defs[key];
    return target ? convert(target, defs, depth + 1) : { type: "STRING" };
  }
  const desc = typeof node.description === "string" ? node.description : undefined;

  // anyOf / oneOf: "X or null" becomes nullable X; string literals merge into one enum;
  // other unions keep the first branch and describe the rest (zod validates the real input).
  const union = (node.anyOf ?? node.oneOf) as Json[] | undefined;
  if (Array.isArray(union)) {
    const nonNull = union.filter((b) => b.type !== "null");
    const nullable = nonNull.length < union.length;
    const literals = nonNull.every((b) => typeof b.const === "string" || (Array.isArray(b.enum) && b.enum.every((e) => typeof e === "string")));
    if (literals && nonNull.length > 0) {
      const values = nonNull.flatMap((b) => (Array.isArray(b.enum) ? (b.enum as string[]) : [b.const as string]));
      return { type: "STRING", enum: [...new Set(values)], ...(nullable ? { nullable } : {}), ...(desc ? { description: desc } : {}) };
    }
    if (nonNull.length > 0 && nonNull.every((b) => typeof b.const === "number")) {
      const values = nonNull.map((b) => b.const as number);
      return {
        type: values.every(Number.isInteger) ? "INTEGER" : "NUMBER",
        ...(nullable ? { nullable } : {}),
        description: note([desc, `One of ${values.join(", ")}.`]),
      };
    }
    if (nonNull.length === 1) {
      const inner = convert(nonNull[0]!, defs, depth + 1);
      return { ...inner, ...(nullable ? { nullable: true } : {}), ...(desc ? { description: note([desc, inner.description]) } : {}) };
    }
    // Objects of a discriminated union: merge their properties (all optional) so every variant can be expressed.
    if (nonNull.every((b) => b.type === "object" || b.properties)) {
      const merged: Record<string, GeminiSchema> = {};
      for (const b of nonNull) {
        const c = convert(b, defs, depth + 1);
        for (const [k, v] of Object.entries(c.properties ?? {})) {
          const prev = merged[k];
          if (prev?.enum && v.enum) merged[k] = { ...prev, enum: [...new Set([...prev.enum, ...v.enum])] };
          else if (!prev) merged[k] = v;
        }
      }
      return {
        type: "OBJECT",
        properties: merged,
        ...(nullable ? { nullable } : {}),
        description: note([desc, `One of ${nonNull.length} shapes; include the fields of one shape.`]),
      };
    }
    const first = convert(nonNull[0] ?? { type: "string" }, defs, depth + 1);
    return { ...first, ...(nullable ? { nullable: true } : {}), description: note([desc, first.description, "(also accepts other forms)"]) };
  }
  if (Array.isArray(node.allOf) && node.allOf.length > 0) {
    return convert(Object.assign({}, ...(node.allOf as Json[]), { description: desc }), defs, depth + 1);
  }

  if (node.const !== undefined) {
    return typeof node.const === "string"
      ? { type: "STRING", enum: [node.const], ...(desc ? { description: desc } : {}) }
      : { type: typeof node.const === "number" ? "NUMBER" : "BOOLEAN", description: note([desc, `Must be ${JSON.stringify(node.const)}.`]) };
  }
  if (Array.isArray(node.enum)) {
    const values = node.enum as unknown[];
    if (values.every((v) => typeof v === "string")) return { type: "STRING", enum: values as string[], ...(desc ? { description: desc } : {}) };
    return { type: "NUMBER", description: note([desc, `One of ${values.map((v) => JSON.stringify(v)).join(", ")}.`]) };
  }

  let rawType = node.type;
  let nullable = false;
  if (Array.isArray(rawType)) {
    nullable = rawType.includes("null");
    rawType = rawType.find((t) => t !== "null") ?? "string";
  }
  const type = TYPE_MAP[String(rawType)] ?? (node.properties ? "OBJECT" : node.items ? "ARRAY" : depth > 0 && rawType === undefined ? "OBJECT" : "STRING");
  // Gemini rejects an OBJECT without properties (records, unknown values): take those as a JSON
  // string instead; the harness decodes JSON strings before validating (harness.ts decodeJsonStrings).
  if (type === "OBJECT" && depth > 0 && Object.keys((node.properties ?? {}) as object).length === 0) {
    return { type: "STRING", ...(nullable ? { nullable } : {}), description: note([desc, 'A JSON object written as a string, e.g. {"key": "value"}.']) };
  }
  const out: GeminiSchema = { type };
  const hints: string[] = [];
  if (nullable) out.nullable = true;
  if (type === "OBJECT") {
    const props = (node.properties ?? {}) as Record<string, Json>;
    out.properties = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, withKeyHint(k, convert(v, defs, depth + 1))]));
    const req = (node.required as string[] | undefined)?.filter((k) => k in props);
    if (req?.length) out.required = req;
    if (Object.keys(props).length === 0 && node.additionalProperties) hints.push("A map from keys to values.");
  } else if (type === "ARRAY") {
    out.items = node.items ? convert(node.items as Json, defs, depth + 1) : { type: "STRING" };
    if (typeof node.minItems === "number") out.minItems = String(node.minItems);
    if (typeof node.maxItems === "number") out.maxItems = String(node.maxItems);
  } else if (type === "NUMBER" || type === "INTEGER") {
    if (typeof node.minimum === "number" && Math.abs(node.minimum) < 1e12) out.minimum = node.minimum;
    if (typeof node.maximum === "number" && Math.abs(node.maximum) < 1e12) out.maximum = node.maximum;
    if (typeof node.exclusiveMinimum === "number") hints.push(`Greater than ${node.exclusiveMinimum}.`);
    if (typeof node.exclusiveMaximum === "number") hints.push(`Less than ${node.exclusiveMaximum}.`);
  } else if (type === "STRING") {
    if (node.format === "date") hints.push("Date as YYYY-MM-DD.");
    else if (node.format === "date-time") out.format = "date-time";
    if (typeof node.pattern === "string") {
      if (node.pattern === "^\\d{4}-\\d{2}-\\d{2}$") hints.push("Date as YYYY-MM-DD.");
      else if (node.pattern === "^\\d{4}-\\d{2}$") hints.push("Month as YYYY-MM.");
      else hints.push(`Pattern: ${node.pattern}`);
    }
  }
  if (node.default !== undefined) hints.push(`Default ${JSON.stringify(node.default)}.`);
  const d = note([desc, ...hints]);
  if (d) out.description = d;
  return out;
}

/** The Gemini `parameters` object for a zod schema (always an OBJECT at the top). */
export function toGeminiParameters(schema: z.ZodType): GeminiSchema {
  let json: Json;
  try {
    json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any", reused: "inline" }) as Json;
  } catch {
    return { type: "OBJECT", properties: {}, description: "Free-form input." };
  }
  const defs = (json.$defs ?? json.definitions ?? {}) as Record<string, Json>;
  const out = convert(json, defs, 0);
  if (out.type !== "OBJECT") return { type: "OBJECT", properties: { value: out }, required: ["value"] };
  return out;
}
