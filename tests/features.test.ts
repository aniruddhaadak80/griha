import { describe, expect, it } from "vitest";
import { bandFor, buildPredictionTargets, buildTrainingTable } from "@/lib/ml/features";
import { TABPFN_FEATURES } from "@/lib/types";
import type { Chore, Completion, HouseholdContext, Member } from "@/lib/types";

/**
 * These tests pin the feature construction, which is the part of the ML layer
 * that is easy to get quietly wrong. The model itself is verified in a browser,
 * because it is a browser-only artefact; the numbers it is handed are verified
 * here.
 */

const TODAY = "2026-10-05";

function member(id: string, name: string, capacity = 1): Member {
  return {
    id,
    householdId: "hh-1",
    name,
    capacity,
    tint: "terracotta",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    deleted: false,
  };
}

function chore(overrides: Partial<Chore> = {}): Chore {
  return {
    id: "c-1",
    householdId: "hh-1",
    title: "Bins",
    category: "admin",
    effortMinutes: 10,
    dueOn: TODAY,
    assigneeId: null,
    status: "open",
    outdoor: false,
    note: "",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    deleted: false,
    ...overrides,
  };
}

function completion(overrides: Partial<Completion> = {}): Completion {
  return {
    id: "x-1",
    householdId: "hh-1",
    choreId: "c-1",
    memberId: "m-1",
    completedOn: "2026-10-02",
    minutesSpent: 10,
    createdAt: "2026-10-02T00:00:00.000Z",
    ...overrides,
  };
}

const context: HouseholdContext = {
  weather: {
    status: "live",
    city: "Delhi",
    latitude: 28.6,
    longitude: 77.2,
    fetchedAt: "2026-10-05T00:00:00.000Z",
    source: "Open-Meteo",
    sourceUrl: "https://api.open-meteo.com/v1/forecast",
    days: [],
  },
  holidays: {
    status: "live",
    country: "IN",
    year: 2026,
    fetchedAt: "2026-10-05T00:00:00.000Z",
    source: "Nager.Date",
    sourceUrl: "https://date.nager.at",
    days: [{ date: "2026-10-02", localName: "Gandhi Jayanti", name: "Gandhi Jayanti" }],
  },
  holidayIndex: { "2026-10-02": "Gandhi Jayanti" },
  coveredThrough: null,
};

describe("buildTrainingTable", () => {
  it("returns nothing for a household with no members, rather than guessing", () => {
    const rows = buildTrainingTable({
      members: [],
      chores: [chore()],
      completions: [completion()],
      context,
      today: TODAY,
    });
    expect(rows).toEqual([]);
  });

  it("emits one positive row per recorded completion", () => {
    const rows = buildTrainingTable({
      members: [member("m-1", "A")],
      chores: [chore()],
      completions: [completion(), completion({ id: "x-2", memberId: "m-1" })],
      context,
      today: TODAY,
    });
    expect(rows.filter((r) => r.label === 1)).toHaveLength(2);
  });

  it("emits a negative row for an overdue chore that was never done", () => {
    const rows = buildTrainingTable({
      members: [member("m-1", "A")],
      chores: [chore({ id: "c-9", dueOn: "2026-09-20", assigneeId: "m-1", status: "open" })],
      completions: [],
      context,
      today: TODAY,
    });
    const missed = rows.filter((r) => r.label === 0);
    expect(missed).toHaveLength(1);
    expect(missed[0]!.origin).toBe("missed");
  });

  it("does not invent negatives from unclaimed chores", () => {
    // An unclaimed chore is a scheduling failure, not somebody failing to do it.
    const rows = buildTrainingTable({
      members: [member("m-1", "A")],
      chores: [chore({ id: "c-9", dueOn: "2026-09-20", assigneeId: null })],
      completions: [],
      context,
      today: TODAY,
    });
    expect(rows.filter((r) => r.label === 0)).toHaveLength(0);
  });

  it("does not invent negatives from future chores", () => {
    const rows = buildTrainingTable({
      members: [member("m-1", "A")],
      chores: [chore({ id: "c-9", dueOn: "2026-12-01", assigneeId: "m-1" })],
      completions: [],
      context,
      today: TODAY,
    });
    expect(rows.filter((r) => r.label === 0)).toHaveLength(0);
  });

  it("produces exactly one vector per declared feature", () => {
    const rows = buildTrainingTable({
      members: [member("m-1", "A")],
      chores: [chore()],
      completions: [completion()],
      context,
      today: TODAY,
    });
    for (const row of rows) {
      expect(row.features).toHaveLength(TABPFN_FEATURES.length);
      expect(row.features.every((v) => Number.isFinite(v))).toBe(true);
    }
  });

  it("flags a public holiday and an outdoor chore in the right feature slots", () => {
    const holiday = TABPFN_FEATURES.indexOf("isPublicHoliday");
    const outdoor = TABPFN_FEATURES.indexOf("outdoor");
    const rows = buildTrainingTable({
      members: [member("m-1", "A")],
      chores: [chore({ outdoor: true })],
      completions: [completion({ completedOn: "2026-10-02" })],
      context,
      today: TODAY,
    });
    expect(rows[0]!.features[holiday]).toBe(1);
    expect(rows[0]!.features[outdoor]).toBe(1);
  });

  it("encodes weekday as 0–6", () => {
    const weekday = TABPFN_FEATURES.indexOf("weekday");
    const rows = buildTrainingTable({
      members: [member("m-1", "A")],
      chores: [chore()],
      completions: [completion({ completedOn: "2026-10-04" })], // a Sunday
      context,
      today: TODAY,
    });
    expect(rows[0]!.features[weekday]).toBe(0);
  });

  it("clamps outliers so one extreme value cannot dominate the fit", () => {
    const capacity = TABPFN_FEATURES.indexOf("capacity");
    const effort = TABPFN_FEATURES.indexOf("effortMinutes");
    const rows = buildTrainingTable({
      members: [member("m-1", "A", 99)],
      chores: [chore({ effortMinutes: 9999 })],
      completions: [completion()],
      context,
      today: TODAY,
    });
    expect(rows[0]!.features[capacity]).toBeLessThanOrEqual(3);
    expect(rows[0]!.features[effort]).toBeLessThanOrEqual(240);
  });

  it("skips completions whose chore or member no longer exists", () => {
    const rows = buildTrainingTable({
      members: [member("m-1", "A")],
      chores: [chore({ id: "c-other" })],
      completions: [completion({ choreId: "c-gone" })],
      context,
      today: TODAY,
    });
    expect(rows).toHaveLength(0);
  });

  it("is deterministic", () => {
    const input = {
      members: [member("m-1", "A"), member("m-2", "B")],
      chores: [chore({ id: "c-1" }), chore({ id: "c-2", dueOn: "2026-09-20", assigneeId: "m-2" })],
      completions: [completion(), completion({ id: "x-2", memberId: "m-2", choreId: "c-2" })],
      context,
      today: TODAY,
    };
    expect(JSON.stringify(buildTrainingTable(input))).toBe(JSON.stringify(buildTrainingTable(input)));
  });
});

describe("buildPredictionTargets", () => {
  it("returns nothing when there are no open chores", () => {
    const targets = buildPredictionTargets({
      members: [member("m-1", "A")],
      chores: [chore({ status: "done" })],
      completions: [],
      context,
      today: TODAY,
    });
    expect(targets).toEqual([]);
  });

  it("produces one target per open chore and member", () => {
    const targets = buildPredictionTargets({
      members: [member("m-1", "A"), member("m-2", "B")],
      chores: [chore({ id: "c-1" }), chore({ id: "c-2" })],
      completions: [],
      context,
      today: TODAY,
    });
    expect(targets).toHaveLength(4);
    expect(targets.every((t) => t.features.length === TABPFN_FEATURES.length)).toBe(true);
  });

  it("caps the cross-product so a large household cannot stall WASM", () => {
    const members = Array.from({ length: 20 }, (_, i) => member(`m-${i}`, `P${i}`));
    const chores = Array.from({ length: 20 }, (_, i) => chore({ id: `c-${i}` }));
    const targets = buildPredictionTargets({
      members,
      chores,
      completions: [],
      context,
      today: TODAY,
      maxTargets: 25,
    });
    expect(targets).toHaveLength(25);
  });

  it("excludes done and skipped chores from prediction", () => {
    const targets = buildPredictionTargets({
      members: [member("m-1", "A")],
      chores: [chore({ id: "c-1", status: "done" }), chore({ id: "c-2", status: "skipped" })],
      completions: [],
      context,
      today: TODAY,
    });
    expect(targets).toEqual([]);
  });
});

describe("bandFor", () => {
  it("maps probabilities onto honest, wide bands", () => {
    expect(bandFor(0.95)).toBe("likely");
    expect(bandFor(0.7)).toBe("likely");
    expect(bandFor(0.5)).toBe("uncertain");
    expect(bandFor(0.4)).toBe("uncertain");
    expect(bandFor(0.2)).toBe("at-risk");
    expect(bandFor(0)).toBe("at-risk");
  });
});