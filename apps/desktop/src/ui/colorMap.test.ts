import { describe, expect, it } from "vitest";
import { buildColorMap, foldOther, goalColorMap, OTHER_COLOR, OTHER_KEY } from "./colorMap.ts";
import { seriesColors } from "./tokens.ts";

const cats = [
  { key: "groceries", value: 50_000 },
  { key: "rent", value: 200_000 },
  { key: "dining", value: 30_000 },
  { key: "travel", value: 20_000 },
  { key: "fuel", value: 10_000 },
  { key: "fun", value: 9_000 },
  { key: "pets", value: 8_000 },
  { key: "gifts", value: 1_000 },
];

describe("category colour map", () => {
  it("is deterministic regardless of input order", () => {
    const a = buildColorMap(cats);
    const b = buildColorMap([...cats].reverse());
    for (const c of cats) expect(a.get(c.key)).toBe(b.get(c.key));
  });

  it("gives the biggest categories palette colours in rank order", () => {
    const m = buildColorMap(cats);
    expect(m.get("rent")).toBe(seriesColors[0]);
    expect(m.get("groceries")).toBe(seriesColors[1]);
    expect(m.named).toEqual(["rent", "groceries", "dining", "travel", "fuel", "fun"]);
  });

  it("smaller categories and unknown keys share the neutral Other", () => {
    const m = buildColorMap(cats);
    expect(m.get("pets")).toBe(OTHER_COLOR);
    expect(m.get("gifts")).toBe(OTHER_COLOR);
    expect(m.get("never-seen")).toBe(OTHER_COLOR);
    expect(m.isOther("pets")).toBe(true);
  });

  it("drops tiny categories into Other even when colours are free", () => {
    const m = buildColorMap([
      { key: "a", value: 1000 },
      { key: "b", value: 5 },
    ]);
    expect(m.get("a")).toBe(seriesColors[0]);
    expect(m.isOther("b")).toBe(true);
  });

  it("never gives two categories the same colour", () => {
    const m = buildColorMap(cats);
    const colours = m.named.map((k) => m.get(k));
    expect(new Set(colours).size).toBe(colours.length);
  });

  it("breaks ties by key so equal totals are stable", () => {
    const m = buildColorMap([
      { key: "b", value: 10 },
      { key: "a", value: 10 },
    ]);
    expect(m.named).toEqual(["a", "b"]);
  });
});

describe("foldOther", () => {
  it("colours a chart from the global map and merges the Other members last", () => {
    const m = buildColorMap(cats);
    const out = foldOther(
      [
        { key: "pets", label: "Pets", value: 80 },
        { key: "rent", label: "Rent", value: 2000 },
        { key: "gifts", label: "Gifts", value: 10 },
      ],
      m,
    );
    expect(out.map((o) => o.key)).toEqual(["rent", OTHER_KEY]);
    expect(out[1]).toMatchObject({ value: 90, color: OTHER_COLOR, members: ["pets", "gifts"] });
    expect(out[0]?.color).toBe(m.get("rent"));
  });
});

describe("goal colours", () => {
  it("follow creation order, so reordering priorities never recolours", () => {
    const m = goalColorMap(["g1", "g2", "g3"]);
    expect(m.get("g2")).toBe(seriesColors[1]);
    expect(goalColorMap(["g1", "g2", "g3"]).get("g3")).toBe(m.get("g3"));
  });
});
