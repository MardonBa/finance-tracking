/**
 * Money is always whole cents (integers). Never store or add dollar floats.
 *
 * `toCents` is the ONLY place a decimal amount (from Plaid, a form field, or a
 * fixture) becomes cents. Everything after that is integer arithmetic.
 */

/** An amount of money in whole US cents. Always an integer (see `isCents`). */
export type Cents = number;

const DECIMAL_RE = /^([+-])?(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i;

/**
 * Convert a decimal amount (dollars) to whole cents.
 *
 * - Numbers are first turned into their shortest round-trip string, so float
 *   artifacts disappear: `0.1 + 0.2` (0.30000000000000004) → 30, and `1.005`
 *   (stored as 1.00499999…) is treated as the decimal 1.005 that was written.
 * - Strings are parsed exactly as decimals ("12.345", "-0.5", "1e3").
 * - Extra digits are rounded half away from zero: 1.005 → 101, -1.005 → -101,
 *   0.004 → 0, -0.004 → 0 (never -0).
 * - Throws on NaN, Infinity, empty or malformed input, and results beyond
 *   Number.MAX_SAFE_INTEGER cents.
 */
export function toCents(amount: number | string): Cents {
  let text: string;
  if (typeof amount === "number") {
    if (!Number.isFinite(amount)) throw new RangeError(`toCents: not a finite number: ${amount}`);
    text = String(amount);
  } else if (typeof amount === "string") {
    text = amount.trim();
  } else {
    throw new TypeError(`toCents: expected number or string, got ${typeof amount}`);
  }

  const m = DECIMAL_RE.exec(text);
  if (!m) throw new RangeError(`toCents: not a decimal amount: ${JSON.stringify(amount)}`);
  const [, sign, intPart = "", fracPart = "", expPart] = m;
  if (intPart.length === 0 && fracPart.length === 0) {
    throw new RangeError(`toCents: not a decimal amount: ${JSON.stringify(amount)}`);
  }

  const digits = intPart + fracPart;
  // Position of the decimal point inside `digits` after scaling by 100.
  const point = intPart.length + (expPart ? Number.parseInt(expPart, 10) : 0) + 2;

  let wholeDigits: string;
  let firstDropped: string;
  if (point <= 0) {
    wholeDigits = "0";
    firstDropped = point === 0 ? (digits[0] ?? "0") : "0";
  } else if (point >= digits.length) {
    wholeDigits = digits + "0".repeat(point - digits.length);
    firstDropped = "0";
  } else {
    wholeDigits = digits.slice(0, point);
    firstDropped = digits[point] ?? "0";
  }

  let magnitude = BigInt(wholeDigits === "" ? "0" : wholeDigits);
  if (firstDropped >= "5") magnitude += 1n;
  if (magnitude > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`toCents: amount too large: ${JSON.stringify(amount)}`);
  }
  const result = Number(magnitude);
  if (result === 0) return 0;
  return sign === "-" ? -result : result;
}

/** True when `n` is a valid cents value: a safe integer (and not -0). */
export function isCents(n: unknown): n is Cents {
  return typeof n === "number" && Number.isSafeInteger(n) && !Object.is(n, -0);
}

/** Throw if `n` is not a whole number of cents. Use at trust boundaries. */
export function assertCents(n: unknown, label = "amount"): asserts n is Cents {
  if (!isCents(n)) throw new TypeError(`${label} must be integer cents, got ${String(n)}`);
}

function checked(n: number, op: string): Cents {
  if (!Number.isSafeInteger(n)) throw new RangeError(`Money.${op}: result is not a safe integer`);
  return n === 0 ? 0 : n;
}

/** Integer-cents arithmetic. Every function checks its inputs and output. */
export const Money = {
  zero: 0 as Cents,

  add(a: Cents, b: Cents): Cents {
    assertCents(a, "a");
    assertCents(b, "b");
    return checked(a + b, "add");
  },

  sub(a: Cents, b: Cents): Cents {
    assertCents(a, "a");
    assertCents(b, "b");
    return checked(a - b, "sub");
  },

  sum(values: Iterable<Cents>): Cents {
    let total = 0;
    for (const v of values) {
      assertCents(v, "value");
      total += v;
      if (!Number.isSafeInteger(total)) throw new RangeError("Money.sum: overflow");
    }
    return checked(total, "sum");
  },

  negate(a: Cents): Cents {
    assertCents(a);
    return checked(-a, "negate");
  },

  abs(a: Cents): Cents {
    assertCents(a);
    return checked(Math.abs(a), "abs");
  },

  /**
   * Multiply cents by a plain factor (a rate, a share, a number of months) and
   * round half away from zero back to whole cents.
   */
  mul(a: Cents, factor: number): Cents {
    assertCents(a);
    if (!Number.isFinite(factor)) throw new RangeError("Money.mul: factor must be finite");
    return toCents((a * factor) / 100);
  },

  /**
   * Split `total` into parts proportional to `weights`, using the
   * largest-remainder method so the parts always add up to exactly `total`.
   * Ties go to the earlier weight. Weights must be ≥ 0 with a positive sum.
   */
  allocate(total: Cents, weights: readonly number[]): Cents[] {
    assertCents(total, "total");
    if (weights.length === 0) throw new RangeError("Money.allocate: no weights");
    const weightSum = weights.reduce((s, w) => {
      if (!(w >= 0) || !Number.isFinite(w)) throw new RangeError("Money.allocate: bad weight");
      return s + w;
    }, 0);
    if (weightSum <= 0) throw new RangeError("Money.allocate: weights sum to zero");

    const sign = total < 0 ? -1 : 1;
    const abs = Math.abs(total);
    const exact = weights.map((w) => (abs * w) / weightSum);
    const floors = exact.map((x) => Math.floor(x));
    let remaining = abs - floors.reduce((s, x) => s + x, 0);
    const order = exact
      .map((x, i) => ({ i, frac: x - Math.floor(x) }))
      .sort((p, q) => q.frac - p.frac || p.i - q.i);
    for (const { i } of order) {
      if (remaining <= 0) break;
      floors[i] = (floors[i] ?? 0) + 1;
      remaining -= 1;
    }
    return floors.map((x) => (x === 0 ? 0 : sign * x));
  },

  /** Compare for sorting: negative if a < b. */
  compare(a: Cents, b: Cents): number {
    return a - b;
  },

  /** "-1234.5" style decimal string with exactly two decimals, for storage/export. */
  toDecimalString(a: Cents): string {
    assertCents(a);
    const sign = a < 0 ? "-" : "";
    const abs = Math.abs(a);
    return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  },

  /** "$1,234.56" / "-$1,234.56" for display (US dollars, en-US grouping). */
  format(a: Cents, opts: { showPlus?: boolean; noCents?: boolean } = {}): string {
    assertCents(a);
    const sign = a < 0 ? "-" : a > 0 && opts.showPlus ? "+" : "";
    const abs = Math.abs(a);
    const dollars = Math.floor(abs / 100);
    const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    if (opts.noCents) {
      const rounded = Math.floor((abs + 50) / 100);
      return `${sign}$${String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
    }
    return `${sign}$${grouped}.${String(abs % 100).padStart(2, "0")}`;
  },
} as const;
