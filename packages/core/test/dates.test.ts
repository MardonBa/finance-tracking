import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  addMonthsToMonth,
  compareIsoDate,
  dayOfWeek,
  daysInMonth,
  diffDays,
  eachDay,
  eachMonth,
  endOfMonth,
  endOfWeek,
  fromEpochDay,
  isIsoDate,
  isIsoMonth,
  isLeapYear,
  isWithin,
  isoDateInTimeZone,
  monthEnd,
  monthOf,
  startOfMonth,
  startOfWeek,
  toEpochDay,
} from "../src/dates.ts";

describe("validation", () => {
  it("accepts only real calendar dates", () => {
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2023-02-29")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-04-31")).toBe(false);
    expect(isIsoDate("2026-4-1")).toBe(false);
    expect(isIsoDate("2026-11-18T00:00:00Z")).toBe(false);
    expect(isIsoDate(20261118)).toBe(false);
    expect(isIsoMonth("2026-11")).toBe(true);
    expect(isIsoMonth("2026-00")).toBe(false);
  });

  it("knows leap years", () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2026, 11)).toBe(30);
  });
});

describe("arithmetic", () => {
  it("adds days across month, year and leap boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
    expect(addDays("2023-03-01", -1)).toBe("2023-02-28");
    expect(addDays("2026-11-18", 0)).toBe("2026-11-18");
  });

  it("is not affected by daylight-saving changes", () => {
    // US DST ends 2026-11-01 and starts 2026-03-08; days are still whole.
    expect(diffDays("2026-10-31", "2026-11-02")).toBe(2);
    expect(diffDays("2026-03-07", "2026-03-09")).toBe(2);
    expect(eachDay("2026-03-07", "2026-03-09")).toEqual(["2026-03-07", "2026-03-08", "2026-03-09"]);
  });

  it("round-trips epoch days", () => {
    expect(toEpochDay("1970-01-01")).toBe(0);
    expect(fromEpochDay(toEpochDay("2026-11-18"))).toBe("2026-11-18");
    expect(fromEpochDay(-1)).toBe("1969-12-31");
  });

  it("adds months with end-of-month clamping", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2026-11-18", 2)).toBe("2027-01-18");
    expect(addMonths("2026-01-15", -13)).toBe("2024-12-15");
    expect(addMonthsToMonth("2026-12", 1)).toBe("2027-01");
  });

  it("finds month and week bounds", () => {
    expect(startOfMonth("2026-11-18")).toBe("2026-11-01");
    expect(endOfMonth("2024-02-10")).toBe("2024-02-29");
    expect(monthOf("2026-11-18")).toBe("2026-11");
    expect(monthEnd("2026-02")).toBe("2026-02-28");
    // 2026-11-18 is a Wednesday.
    expect(dayOfWeek("2026-11-18")).toBe(2);
    expect(startOfWeek("2026-11-18")).toBe("2026-11-16");
    expect(endOfWeek("2026-11-18")).toBe("2026-11-22");
    expect(endOfWeek("2026-11-22")).toBe("2026-11-22");
    expect(startOfWeek("2026-01-01")).toBe("2025-12-29");
  });

  it("compares and ranges", () => {
    expect(compareIsoDate("2026-01-02", "2026-01-10")).toBe(-1);
    expect(isWithin("2026-01-31", "2026-01-01", "2026-01-31")).toBe(true);
    expect(isWithin("2026-02-01", "2026-01-01", "2026-01-31")).toBe(false);
    expect(eachDay("2026-01-02", "2026-01-01")).toEqual([]);
    expect(eachMonth("2025-11-30", "2026-02-01")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(() => compareIsoDate("2026-1-1", "2026-01-01")).toThrow();
  });
});

describe("isoDateInTimeZone", () => {
  it("returns the calendar date where the user is, not UTC", () => {
    const instant = Date.UTC(2026, 10, 18, 3, 30); // 03:30 UTC on Nov 18
    expect(isoDateInTimeZone(instant, "UTC")).toBe("2026-11-18");
    expect(isoDateInTimeZone(instant, "America/Los_Angeles")).toBe("2026-11-17");
    expect(isoDateInTimeZone(instant, "Asia/Tokyo")).toBe("2026-11-18");
    expect(isoDateInTimeZone(Date.UTC(2026, 11, 31, 23, 0), "Pacific/Kiritimati")).toBe("2027-01-01");
  });
});
