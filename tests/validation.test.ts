import { describe, expect, it } from "vitest";
import {
  LIMITS,
  ValidationError,
  optionalBoolean,
  optionalEnum,
  optionalIsoDate,
  optionalNumber,
  parseChoreCategory,
  parsePagination,
  requireBoolean,
  requireCountry,
  requireEnum,
  requireId,
  requireInt,
  requireIsoDate,
  requireNumber,
  requireString,
} from "@/lib/validation";
import { CHORE_CATEGORIES } from "@/lib/types";

describe("requireString", () => {
  it("trims and accepts a normal value", () => {
    expect(requireString("  Bins out  ", "title")).toBe("Bins out");
  });

  it("rejects non-strings", () => {
    expect(() => requireString(42, "title")).toThrow(ValidationError);
    expect(() => requireString(null, "title")).toThrow(ValidationError);
    expect(() => requireString(undefined, "title")).toThrow(ValidationError);
  });

  it("enforces minimum and maximum length", () => {
    expect(() => requireString("a", "title", { min: 2 })).toThrow(/at least 2/);
    expect(() => requireString("abcdef", "title", { max: 3 })).toThrow(/at most 3/);
    expect(requireString("abcdef", "title", { max: LIMITS.choreTitle })).toBe("abcdef");
  });

  it("enforces a pattern", () => {
    expect(() => requireString("abc", "code", { pattern: /^\d+$/ })).toThrow(ValidationError);
    expect(requireString("123", "code", { pattern: /^\d+$/ })).toBe("123");
  });

  it("carries the field name so the API can point at the right input", () => {
    try {
      requireString("", "title");
      expect.unreachable();
    } catch (error) {
      expect((error as ValidationError).field).toBe("title");
    }
  });
});

describe("requireIsoDate", () => {
  it("accepts a real calendar date", () => {
    expect(requireIsoDate("2026-10-05", "dueOn")).toBe("2026-10-05");
  });

  it("rejects a date that parses but does not exist", () => {
    expect(() => requireIsoDate("2026-02-31", "dueOn")).toThrow(/not a real calendar date/);
    expect(() => requireIsoDate("2026-13-01", "dueOn")).toThrow(ValidationError);
  });

  it("rejects a wrong shape", () => {
    expect(() => requireIsoDate("05-10-2026", "dueOn")).toThrow(ValidationError);
    expect(() => requireIsoDate("2026-10-05T00:00:00Z", "dueOn")).toThrow(ValidationError);
  });

  it("passes undefined through as optional", () => {
    expect(optionalIsoDate(undefined, "dueOn")).toBeUndefined();
    expect(optionalIsoDate("2026-10-05", "dueOn")).toBe("2026-10-05");
  });
});

describe("numeric validation", () => {
  it("requires whole numbers for integers", () => {
    expect(requireInt(10, "n")).toBe(10);
    expect(() => requireInt(10.5, "n")).toThrow(/whole number/);
    expect(() => requireInt("ten", "n")).toThrow(ValidationError);
  });

  it("coerces numeric strings from form and query input", () => {
    expect(requireInt("42", "n")).toBe(42);
    expect(requireNumber("1.5", "n")).toBe(1.5);
  });

  it("enforces bounds", () => {
    expect(() => requireInt(5, "n", { min: 10 })).toThrow(/between 10/);
    expect(() => requireInt(500, "n", { max: 100 })).toThrow(/between/);
    expect(requireInt(20, "n", { min: 1, max: 1440 })).toBe(20);
  });

  it("rejects NaN and Infinity", () => {
    expect(() => requireNumber(Number.NaN, "n")).toThrow(ValidationError);
    expect(() => requireNumber(Number.POSITIVE_INFINITY, "n")).toThrow(ValidationError);
  });

  it("treats null and undefined as absent, but not an empty string", () => {
    // An empty string reaching a number field means the caller sent something
    // wrong; silently reading it as absent would hide a real client bug.
    expect(optionalNumber(undefined, "n")).toBeUndefined();
    expect(optionalNumber(null, "n")).toBeUndefined();
    expect(() => optionalNumber("", "n")).toThrow(ValidationError);
    expect(() => requireInt("", "n")).toThrow(ValidationError);
  });
});

describe("enums, booleans and ids", () => {
  it("accepts only declared enum members", () => {
    expect(requireEnum("kitchen", "category", CHORE_CATEGORIES)).toBe("kitchen");
    expect(() => requireEnum("nuclear", "category", CHORE_CATEGORIES)).toThrow(/must be one of/);
    expect(optionalEnum(undefined, "status", ["a", "b"] as const)).toBeUndefined();
  });

  it("rejects unknown chore categories", () => {
    expect(parseChoreCategory("laundry")).toBe("laundry");
    expect(() => parseChoreCategory("hack")).toThrow(ValidationError);
    expect(() => parseChoreCategory(7)).toThrow(ValidationError);
  });

  it("parses booleans from form strings", () => {
    expect(requireBoolean("true", "outdoor")).toBe(true);
    expect(requireBoolean(false, "outdoor")).toBe(false);
    expect(() => requireBoolean("yes", "outdoor")).toThrow(ValidationError);
    expect(optionalBoolean(null, "outdoor")).toBeUndefined();
  });

  it("upper-cases and bounds country codes", () => {
    expect(requireCountry("in", "country")).toBe("IN");
    expect(() => requireCountry("IND", "country")).toThrow(ValidationError);
    expect(() => requireCountry("1N", "country")).toThrow(ValidationError);
  });

  it("restricts ids to a URL-safe alphabet, blocking injection probes", () => {
    expect(requireId("a1b2c3d4e5f6", "id")).toBe("a1b2c3d4e5f6");
    expect(() => requireId("'; DROP TABLE chores; --", "id")).toThrow(ValidationError);
    expect(() => requireId("short", "id")).toThrow(/at least 8/);
  });
});

describe("parsePagination", () => {
  it("defaults to a bounded page", () => {
    expect(parsePagination(new URLSearchParams())).toEqual({ limit: 25, offset: 0 });
  });

  it("reads explicit values", () => {
    expect(parsePagination(new URLSearchParams("limit=10&offset=30"))).toEqual({ limit: 10, offset: 30 });
  });

  it("clamps hostile values instead of trusting them", () => {
    expect(() => parsePagination(new URLSearchParams("limit=100000"))).toThrow(ValidationError);
    expect(() => parsePagination(new URLSearchParams("limit=-1"))).toThrow(ValidationError);
    expect(() => parsePagination(new URLSearchParams("offset=-5"))).toThrow(ValidationError);
  });
});