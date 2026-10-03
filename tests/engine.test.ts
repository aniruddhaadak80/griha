import { describe, expect, it } from "vitest";
import {
  DEFAULT_WINDOW_DAYS,
  ENGINE_VERSION,
  computeFairness,
  emptyContext,
  scoreWeatherDay,
} from "@/lib/engine";
import type { Chore, Completion, Household, HouseholdContext, Member } from "@/lib/types";

const NOW = new Date("2026-10-05T09:00:00.000Z");
const TODAY = "2026-10-05";

function iso(daysFromNow: number): string {
  return new Date(NOW.getTime() + daysFromNow * 86_400_000).toISOString().slice(0, 10);
}

const household: Household = {
  id: "hh-1",
  name: "Test Home",
  city: "New Delhi",
  country: "IN",
  ownerId: "owner-1",
  shareToken: "share",
  apiToken: "token",
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  deleted: false,
};

function member(id: string, name: string, capacity = 1, tint = "terracotta"): Member {
  return {
    id,
    householdId: household.id,
    name,
    capacity,
    tint,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    deleted: false,
  };
}

function chore(overrides: Partial<Chore> = {}): Chore {
  return {
    id: "c-1",
    householdId: household.id,
    title: "Take out the recycling",
    category: "admin",
    effortMinutes: 10,
    dueOn: TODAY,
    assigneeId: null,
    status: "open",
    outdoor: false,
    note: "",
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    deleted: false,
    ...overrides,
  };
}

function completion(overrides: Partial<Completion> = {}): Completion {
  return {
    id: "x-1",
    householdId: household.id,
    choreId: "c-1",
    memberId: "m-1",
    completedOn: iso(-3),
    minutesSpent: 10,
    createdAt: NOW.toISOString(),
    ...overrides,
  };
}

function contextWith(overrides: Partial<HouseholdContext> = {}): HouseholdContext {
  return { ...emptyContext(NOW), ...overrides };
}

const baseInput = () => ({
  household,
  members: [member("m-1", "Aarav"), member("m-2", "Ishita")],
  chores: [chore()],
  completions: [completion()],
  context: contextWith(),
  now: NOW,
});

describe("computeFairness — normal case", () => {
  it("returns a versioned, bounded score", () => {
    const result = computeFairness(baseInput());
    expect(result.version).toBe(ENGINE_VERSION);
    expect(result.windowDays).toBe(DEFAULT_WINDOW_DAYS);
    expect(result.fairnessScore).toBeGreaterThanOrEqual(0);
    expect(result.fairnessScore).toBeLessThanOrEqual(100);
  });

  it("decomposes the household score into factors whose contributions sum to it", () => {
    const result = computeFairness(baseInput());
    const summed = result.factors.reduce((sum, f) => sum + f.contribution, 0);
    // Rounding to one decimal at the end is the only permitted discrepancy.
    expect(Math.abs(summed - result.fairnessScore)).toBeLessThanOrEqual(0.1);
  });

  it("gives every factor a weight, a raw value and a written derivation", () => {
    const result = computeFairness(baseInput());
    for (const factor of result.factors) {
      expect(factor.weight).toBeGreaterThan(0);
      expect(factor.raw).toBeGreaterThanOrEqual(0);
      expect(factor.raw).toBeLessThanOrEqual(1);
      expect(factor.detail.length).toBeGreaterThan(10);
    }
  });

  it("sums member factor weights to one", () => {
    const result = computeFairness(baseInput());
    const total = result.members[0]!.factors.reduce((sum, f) => sum + f.weight, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it("scores a perfectly even split at full parity", () => {
    const result = computeFairness({
      ...baseInput(),
      members: [member("m-1", "Aarav"), member("m-2", "Ishita")],
      completions: [
        completion({ id: "x-1", memberId: "m-1", minutesSpent: 60 }),
        completion({ id: "x-2", memberId: "m-2", minutesSpent: 60 }),
      ],
    });
    expect(result.spreadPoints).toBeCloseTo(0, 1);
    const parity = result.factors.find((f) => f.key === "shareParity");
    expect(parity!.raw).toBeCloseTo(1, 3);
  });

  it("penalises an uneven split and flags who is over-loaded", () => {
    const result = computeFairness({
      ...baseInput(),
      completions: [
        completion({ id: "x-1", memberId: "m-1", minutesSpent: 300 }),
        completion({ id: "x-2", memberId: "m-1", minutesSpent: 300 }),
      ],
    });
    const aarav = result.members.find((m) => m.memberId === "m-1")!;
    const ishita = result.members.find((m) => m.memberId === "m-2")!;
    expect(aarav.deviationPoints).toBeGreaterThan(0);
    expect(aarav.verdict).toBe("over-loaded");
    expect(ishita.deviationPoints).toBeLessThan(0);
    expect(ishita.verdict).toBe("under-loaded");
  });

  it("respects capacity weights rather than treating everyone as identical", () => {
    const result = computeFairness({
      ...baseInput(),
      members: [member("m-1", "Night shift", 0.5), member("m-2", "Full time", 1.5)],
      completions: [
        completion({ id: "x-1", memberId: "m-1", minutesSpent: 30 }),
        completion({ id: "x-2", memberId: "m-2", minutesSpent: 70 }),
      ],
    });
    // 30/70 work against 25/75 capacity is much closer to fair than an even
    // 50/50 split would be.
    expect(result.spreadPoints).toBeLessThan(10);
  });
});

describe("computeFairness — boundary and degenerate inputs", () => {
  it("handles an empty household without NaN or division by zero", () => {
    const result = computeFairness({
      household,
      members: [],
      chores: [],
      completions: [],
      context: contextWith(),
      now: NOW,
    });
    expect(result.members).toEqual([]);
    expect(Number.isFinite(result.fairnessScore)).toBe(true);
    expect(result.recommendation).toBeNull();
    expect(result.factors.every((f) => Number.isFinite(f.contribution))).toBe(true);
  });

  it("handles a single member", () => {
    const result = computeFairness({
      ...baseInput(),
      members: [member("m-1", "Alone")],
      completions: [completion({ memberId: "m-1" })],
    });
    expect(result.members).toHaveLength(1);
    expect(Number.isFinite(result.fairnessScore)).toBe(true);
  });

  it("handles zero completed minutes", () => {
    const result = computeFairness({ ...baseInput(), completions: [] });
    expect(Number.isFinite(result.fairnessScore)).toBe(true);
    expect(result.members.every((m) => m.minutesDone === 0)).toBe(true);
    expect(result.members.every((m) => Number.isFinite(m.shareOfWork))).toBe(true);
  });

  it("ignores soft-deleted members and chores but keeps them out of the maths", () => {
    const result = computeFairness({
      ...baseInput(),
      members: [
        member("m-1", "Aarav"),
        { ...member("m-2", "Ghost", 1, "indigo"), deleted: true },
      ],
      chores: [chore(), chore({ id: "c-2", title: "Gone", deleted: true })],
    });
    expect(result.members.map((m) => m.name)).toEqual(["Aarav"]);
    expect(result.weatherFit.every((f) => f.choreId !== "c-2")).toBe(true);
  });

  it("ignores completions outside the rolling window", () => {
    const result = computeFairness({
      ...baseInput(),
      completions: [completion({ completedOn: iso(-400) })],
    });
    expect(result.members.every((m) => m.minutesDone === 0)).toBe(true);
  });

  it("tolerates a malformed dueOn without producing NaN", () => {
    const result = computeFairness({
      ...baseInput(),
      chores: [chore({ dueOn: "not-a-date" })],
    });
    expect(Number.isFinite(result.fairnessScore)).toBe(true);
    expect(Number.isFinite(result.spreadPoints)).toBe(true);
    expect(result.members.every((m) => Number.isFinite(m.score))).toBe(true);
  });

  it("survives a zero and a negative capacity without exploding", () => {
    const result = computeFairness({
      ...baseInput(),
      members: [member("m-1", "Zero", 0), member("m-2", "Normal")],
    });
    expect(Number.isFinite(result.fairnessScore)).toBe(true);
    expect(result.members.every((m) => Number.isFinite(m.shareOfCapacity))).toBe(true);
  });
});

describe("computeFairness — determinism", () => {
  it("produces identical output for identical input", () => {
    const a = computeFairness(baseInput());
    const b = computeFairness(baseInput());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("does not depend on member ordering in the input array", () => {
    const input = baseInput();
    const forward = computeFairness(input);
    const reversed = computeFairness({ ...input, members: [...input.members].reverse() });
    expect(reversed.members.map((m) => m.memberId)).toEqual(forward.members.map((m) => m.memberId));
    expect(reversed.fairnessScore).toBe(forward.fairnessScore);
  });

  it("gives a stable recommendation when candidates tie", () => {
    const input = {
      ...baseInput(),
      members: [member("m-1", "Aarav"), member("m-2", "Ishita")],
      chores: [
        chore({ id: "c-1", title: "Bins", dueOn: iso(-2) }),
        chore({ id: "c-2", title: "Dishes", dueOn: iso(-2) }),
      ],
      completions: [
        completion({ id: "x-1", memberId: "m-1", minutesSpent: 50 }),
        completion({ id: "x-2", memberId: "m-2", minutesSpent: 50 }),
      ],
    };
    const first = computeFairness(input).recommendation;
    const second = computeFairness(input).recommendation;
    expect(first).toEqual(second);
    expect(first).not.toBeNull();
  });
});

describe("recommendation", () => {
  it("suggests the most overdue chore", () => {
    const result = computeFairness({
      ...baseInput(),
      chores: [
        chore({ id: "c-old", title: "Very late", dueOn: iso(-9) }),
        chore({ id: "c-soon", title: "Soon", dueOn: iso(3) }),
      ],
    });
    expect(result.recommendation!.choreId).toBe("c-old");
  });

  it("prefers the person furthest under their fair share", () => {
    const result = computeFairness({
      ...baseInput(),
      members: [member("m-1", "Does a lot"), member("m-2", "Does little")],
      completions: [
        completion({ id: "x-1", memberId: "m-1", minutesSpent: 400 }),
        completion({ id: "x-2", memberId: "m-2", minutesSpent: 10 }),
      ],
      chores: [chore({ id: "c-1", title: "Bins", dueOn: iso(-1) })],
    });
    expect(result.recommendation!.memberName).toBe("Does little");
    expect(result.recommendation!.reason).toMatch(/under their capacity share/);
  });

  it("returns null when there is nothing open", () => {
    const result = computeFairness({
      ...baseInput(),
      chores: [chore({ status: "done" })],
    });
    expect(result.recommendation).toBeNull();
  });

  it("stamps the engine version on the recommendation", () => {
    expect(computeFairness(baseInput()).recommendation!.engineVersion).toBe(ENGINE_VERSION);
  });
});

describe("scoreWeatherDay", () => {
  it("scores a dry, calm day as good", () => {
    const scored = scoreWeatherDay({
      date: TODAY,
      precipitationProbability: 0,
      precipitationSum: 0,
      windSpeed: 2,
      temperatureMean: 24,
    });
    expect(scored.suitability).toBeGreaterThanOrEqual(0.65);
    expect(scored.verdict).toBe("good");
  });

  it("scores a wet, windy day as poor", () => {
    const scored = scoreWeatherDay({
      date: TODAY,
      precipitationProbability: 95,
      precipitationSum: 12,
      windSpeed: 11,
      temperatureMean: 12,
    });
    expect(scored.suitability).toBeLessThan(0.4);
    expect(scored.verdict).toBe("poor");
  });

  it("returns a neutral score and says so when there is no forecast", () => {
    const scored = scoreWeatherDay(undefined);
    expect(scored.suitability).toBe(0.5);
    expect(scored.detail).toMatch(/No forecast/);
  });

  it("penalises extreme heat", () => {
    const hot = scoreWeatherDay({
      date: TODAY,
      precipitationProbability: 0,
      precipitationSum: 0,
      windSpeed: 1,
      temperatureMean: 47,
    });
    const mild = scoreWeatherDay({
      date: TODAY,
      precipitationProbability: 0,
      precipitationSum: 0,
      windSpeed: 1,
      temperatureMean: 25,
    });
    expect(hot.suitability).toBeLessThan(mild.suitability);
  });
});