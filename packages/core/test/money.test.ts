import { describe, expect, it } from "vitest";
import { Money, assertCents, isCents, toCents } from "../src/money.ts";

describe("toCents", () => {
  it.each([
    [0, 0],
    [1, 100],
    [12.34, 1234],
    [-12.34, -1234],
    [0.01, 1],
    [-0.01, -1],
    [100, 10000],
    [1234567.89, 123456789],
  ])("converts the number %s to %s cents", (input, cents) => {
    expect(toCents(input)).toBe(cents);
  });

  it("removes floating-point artifacts", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(1.1 + 2.2)).toBe(330); // 3.3000000000000003
    expect(toCents(0.7 + 0.1)).toBe(80); // 0.7999999999999999
    expect(toCents(19.99 * 3)).toBe(5997); // 59.97000000000001
    expect(toCents(-(0.1 + 0.2))).toBe(-30);
  });

  it("treats numbers as the decimal that was written (1.005 → 101, not 100)", () => {
    expect(1.005 * 100).toBeLessThan(100.5); // the naive approach rounds down
    expect(toCents(1.005)).toBe(101);
    expect(toCents(2.675)).toBe(268);
    expect(toCents(1.015)).toBe(102);
  });

  it("rounds sub-cent amounts half away from zero", () => {
    expect(toCents(0.004)).toBe(0);
    expect(toCents(0.005)).toBe(1);
    expect(toCents(0.0049999)).toBe(0);
    expect(toCents(-0.005)).toBe(-1);
    expect(toCents(-0.004)).toBe(0);
    expect(Object.is(toCents(-0.004), -0)).toBe(false);
    expect(toCents(12.3456)).toBe(1235);
    expect(toCents(-12.3449)).toBe(-1234);
    expect(toCents(0.999)).toBe(100);
  });

  it("parses decimal strings exactly", () => {
    expect(toCents("12.34")).toBe(1234);
    expect(toCents("-12.34")).toBe(-1234);
    expect(toCents("+5")).toBe(500);
    expect(toCents(" 7.1 ")).toBe(710);
    expect(toCents(".5")).toBe(50);
    expect(toCents("5.")).toBe(500);
    expect(toCents("0.125")).toBe(13);
    expect(toCents("1.00499999999999999999")).toBe(100);
    expect(toCents("-0")).toBe(0);
    expect(toCents("00012.30")).toBe(1230);
  });

  it("handles exponent notation", () => {
    expect(toCents(1e-7)).toBe(0);
    expect(toCents(5e-3)).toBe(1);
    expect(toCents("1.5e2")).toBe(15000);
    expect(toCents("1E-2")).toBe(1);
    expect(toCents(1e10)).toBe(1_000_000_000_000);
  });

  it("rejects invalid input", () => {
    expect(() => toCents(Number.NaN)).toThrow(RangeError);
    expect(() => toCents(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => toCents("")).toThrow(RangeError);
    expect(() => toCents(".")).toThrow(RangeError);
    expect(() => toCents("1,000.00")).toThrow(RangeError);
    expect(() => toCents("$5")).toThrow(RangeError);
    expect(() => toCents("abc")).toThrow(RangeError);
    expect(() => toCents("1e400")).toThrow(RangeError);
    expect(() => toCents(1e17)).toThrow(RangeError);
    expect(() => toCents(null as unknown as number)).toThrow(TypeError);
  });

  it("round-trips every cent value from -100.00 to 100.00", () => {
    for (let c = -10000; c <= 10000; c++) {
      expect(toCents(c / 100)).toBe(c);
      expect(toCents(Money.toDecimalString(c))).toBe(c);
    }
  });
});

describe("isCents / assertCents", () => {
  it("accepts safe integers only", () => {
    expect(isCents(0)).toBe(true);
    expect(isCents(-5)).toBe(true);
    expect(isCents(1.5)).toBe(false);
    expect(isCents(-0)).toBe(false);
    expect(isCents("5")).toBe(false);
    expect(isCents(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
    expect(() => assertCents(0.1)).toThrow(TypeError);
  });
});

describe("Money", () => {
  it("adds, subtracts, sums and negates integers", () => {
    expect(Money.add(1, 2)).toBe(3);
    expect(Money.sub(1, 2)).toBe(-1);
    expect(Money.sum([10, -3, 5])).toBe(12);
    expect(Money.sum([])).toBe(0);
    expect(Money.negate(5)).toBe(-5);
    expect(Object.is(Money.negate(0), -0)).toBe(false);
    expect(Money.abs(-7)).toBe(7);
  });

  it("refuses floats and overflow", () => {
    expect(() => Money.add(0.1, 0.2)).toThrow(TypeError);
    expect(() => Money.sum([1, 0.5])).toThrow(TypeError);
    expect(() => Money.add(Number.MAX_SAFE_INTEGER, 1)).toThrow(RangeError);
  });

  it("multiplies with half-away-from-zero rounding", () => {
    expect(Money.mul(1000, 0.045)).toBe(45);
    expect(Money.mul(101, 0.5)).toBe(51);
    expect(Money.mul(-101, 0.5)).toBe(-51);
    expect(Money.mul(333, 1 / 3)).toBe(111);
    expect(Money.mul(12345, 12)).toBe(148140);
  });

  it("allocates exactly, with remainders to the largest fractions", () => {
    expect(Money.allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(Money.allocate(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
    expect(Money.allocate(5, [0, 1])).toEqual([0, 5]);
    expect(Money.allocate(0, [1, 2])).toEqual([0, 0]);
    for (const total of [1, 99, 1001, -12345]) {
      expect(Money.sum(Money.allocate(total, [3, 7, 11, 0.5]))).toBe(total);
    }
    expect(() => Money.allocate(5, [])).toThrow();
    expect(() => Money.allocate(5, [0, 0])).toThrow();
    expect(() => Money.allocate(5, [-1, 2])).toThrow();
  });

  it("formats for display and storage", () => {
    expect(Money.format(123456)).toBe("$1,234.56");
    expect(Money.format(-5)).toBe("-$0.05");
    expect(Money.format(5, { showPlus: true })).toBe("+$0.05");
    expect(Money.format(0, { showPlus: true })).toBe("$0.00");
    expect(Money.format(123456789, { noCents: true })).toBe("$1,234,568");
    expect(Money.toDecimalString(-1234)).toBe("-12.34");
    expect(Money.toDecimalString(5)).toBe("0.05");
  });
});
