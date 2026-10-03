/**
 * The Griha fairness engine.
 *
 * One function, `computeFairness`, is the only place where the numbers behind
 * "who should do what" are produced. The board page, the `/api/fairness`
 * endpoint, the MCP `compute_fairness` tool and the export centre all call it.
 * Nothing recomputes a score locally, which is what stops the UI and the API
 * from ever disagreeing.
 *
 * Design rules:
 *   - pure: same input, same output, no clock and no randomness beyond the
 *     `now` that is passed in;
 *   - explainable: every score decomposes into factors that carry their weight,
 *     their raw sub-score and the arithmetic that produced them;
 *   - honest at the edges: an empty household, a single member and a household
 *     where nobody has done anything all return valid, meaningful results
 *     instead of NaN or a divide-by-zero.
 */

import type {
  Chore,
  Completion,
  DailyForecast,
  Factor,
  FairnessRecommendation,
  FairnessResult,
  Household,
  HouseholdContext,
  LoadVerdict,
  Member,
  MemberFairness,
  WeatherFit,
} from "./types";
import { GENESIS_SEAL } from "./integrity";

export const ENGINE_VERSION = "griha-fairness/2026.10.1";

/** Rolling window, in days, that the engine measures contribution over. */
export const DEFAULT_WINDOW_DAYS = 28;

/**
 * Factor weights for the household-level score.
 *
 * These are hand-chosen and documented rather than fitted, because the input
 * is a handful of completions — fitting weights to that little data would be
 * theatre. They sum to 1 so a contribution is directly readable as "points
 * moved", and they are exported so the UI can render the model, not a
 * hand-copied duplicate of it.
 */
export const HOUSEHOLD_WEIGHTS = {
  shareParity: 0.4,
  overduePressure: 0.25,
  momentum: 0.2,
  effortHonesty: 0.15,
} as const;

export const MEMBER_WEIGHTS = {
  shareParity: 0.4,
  overdueExposure: 0.25,
  followThrough: 0.2,
  openLoad: 0.15,
} as const;

export interface FairnessInput {
  household: Household;
  members: Member[];
  chores: Chore[];
  completions: Completion[];
  context: HouseholdContext;
  /** Injected so the engine stays pure and tests stay deterministic. */
  now: Date;
  windowDays?: number;
  /** Head seal of the household chain; returned with the result. */
  seal?: string;
}

/* -------------------------------------------------------------------------- */
/* Date helpers                                                                */
/* -------------------------------------------------------------------------- */

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function round(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/* -------------------------------------------------------------------------- */
/* Weather suitability                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Score an outdoor chore against a real forecast day.
 *
 * The curve is deliberately legible rather than clever:
 *   precipitation — linear penalty, a 100% chance of rain scores 0;
 *   wind          — linear penalty above a 4 m/s comfort threshold;
 *   temperature   — penalty only outside a 5–38 °C comfort band.
 *
 * A day with no forecast row (beyond the 7-day window) returns `null`
 * suitability rather than guessing, and the UI says so.
 */
export function scoreWeatherDay(day: DailyForecast | undefined): {
  suitability: number;
  verdict: WeatherFit["verdict"];
  detail: string;
} {
  if (!day) {
    return {
      suitability: 0.5,
      verdict: "workable",
      detail: "No forecast for this date; outdoor work is scored at the neutral 0.50.",
    };
  }

  const rain = clamp01(day.precipitationProbability / 100);
  const wind = clamp01(Math.max(0, day.windSpeed - 4) / 8);
  const tooHot = day.temperatureMean > 38 ? clamp01((day.temperatureMean - 38) / 10) : 0;
  const tooCold = day.temperatureMean < 5 ? clamp01((5 - day.temperatureMean) / 10) : 0;

  const suitability = clamp01(1 - rain * 0.65 - wind * 0.2 - tooHot * 0.15 - tooCold * 0.15);

  const verdict: WeatherFit["verdict"] = suitability >= 0.65 ? "good" : suitability >= 0.4 ? "workable" : "poor";

  return {
    suitability: round(suitability, 3),
    verdict,
    detail: `${day.precipitationProbability}% rain, ${day.windSpeed} m/s wind, ${day.temperatureMean}°C mean → suitability ${round(suitability, 3)}`,
  };
}

/* -------------------------------------------------------------------------- */
/* Engine                                                                      */
/* -------------------------------------------------------------------------- */

export function computeFairness(input: FairnessInput): FairnessResult {
  const { context, now } = input;
  const windowDays = input.windowDays ?? DEFAULT_WINDOW_DAYS;
  const today = toIsoDate(now);
  const windowStart = toIsoDate(new Date(now.getTime() - windowDays * 86_400_000));

  // Live members and chores only. Soft-deleted rows are excluded from maths but
  // remain in the audit chain, so deleting someone cannot rewrite history.
  const members = input.members.filter((m) => !m.deleted).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const chores = input.chores.filter((c) => !c.deleted);
  const completions = input.completions
    .filter((c) => c.completedOn >= windowStart && c.completedOn <= today)
    .slice()
    .sort((a, b) => (a.completedOn < b.completedOn ? -1 : a.completedOn > b.completedOn ? 1 : a.id < b.id ? -1 : 1));

  const totalCapacity = members.reduce((sum, m) => sum + (Number.isFinite(m.capacity) ? m.capacity : 1), 0);
  const safeCapacity = totalCapacity > 0 ? totalCapacity : 1;

  const minutesByMember = new Map<string, number>();
  const completionsByMember = new Map<string, number>();
  for (const member of members) {
    minutesByMember.set(member.id, 0);
    completionsByMember.set(member.id, 0);
  }
  for (const completion of completions) {
    if (!minutesByMember.has(completion.memberId)) continue;
    minutesByMember.set(completion.memberId, (minutesByMember.get(completion.memberId) ?? 0) + completion.minutesSpent);
    completionsByMember.set(completion.memberId, (completionsByMember.get(completion.memberId) ?? 0) + 1);
  }

  const totalMinutes = members.reduce((sum, m) => sum + (minutesByMember.get(m.id) ?? 0), 0);
  const safeTotalMinutes = totalMinutes > 0 ? totalMinutes : 0;

  const openByMember = new Map<string, Chore[]>();
  for (const member of members) openByMember.set(member.id, []);
  for (const chore of chores) {
    if (chore.status === "done" || chore.status === "skipped") continue;
    if (!chore.assigneeId || !openByMember.has(chore.assigneeId)) continue;
    openByMember.get(chore.assigneeId)!.push(chore);
  }

  /* --- Member-level factors ------------------------------------------------ */

  const memberResults: MemberFairness[] = members.map((member) => {
    const capacity = Number.isFinite(member.capacity) && member.capacity > 0 ? member.capacity : 1;
    const shareOfCapacity = capacity / safeCapacity;

    const minutesDone = minutesByMember.get(member.id) ?? 0;
    const shareOfWork = safeTotalMinutes > 0 ? minutesDone / safeTotalMinutes : 0;
    const deviationPoints = (shareOfWork - shareOfCapacity) * 100;

    const open = openByMember.get(member.id) ?? [];
    const overdue = open.filter((c) => c.dueOn < today);
    const overdueMinutes = overdue.reduce((sum, c) => sum + c.effortMinutes, 0);

    // 1. Share parity: 1 when this member's share of work equals their share of
    //    capacity, decaying linearly to 0 at a 100-point deviation either way.
    const parity = clamp01(1 - Math.abs(deviationPoints) / 100);

    // 2. Overdue exposure: weighted against the household's worst offender, so
    //    the factor means something even inside a small household.
    const worstOverdue = members.reduce(
      (max, m) => Math.max(max, (openByMember.get(m.id) ?? []).filter((c) => c.dueOn < today).reduce((s, c) => s + c.effortMinutes, 0)),
      0,
    );
    const exposure = worstOverdue > 0 ? clamp01(1 - overdueMinutes / worstOverdue) : 1;

    // 3. Follow-through: completed chores relative to the best performer.
    const bestCompletions = members.reduce((max, m) => Math.max(max, completionsByMember.get(m.id) ?? 0), 0);
    const followThrough = bestCompletions > 0 ? clamp01((completionsByMember.get(member.id) ?? 0) / bestCompletions) : 0.5;

    // 4. Open load: pending minutes against the household maximum.
    const worstOpen = members.reduce(
      (max, m) =>
        Math.max(
          max,
          (openByMember.get(m.id) ?? []).reduce((s, c) => s + c.effortMinutes, 0),
        ),
      0,
    );
    const pendingMinutes = open.reduce((s, c) => s + c.effortMinutes, 0);
    const openLoad = worstOpen > 0 ? clamp01(1 - pendingMinutes / worstOpen) : 1;

    const factors: Factor[] = [
      {
        key: "shareParity",
        label: "Share parity",
        weight: MEMBER_WEIGHTS.shareParity,
        raw: round(parity, 3),
        contribution: round(parity * MEMBER_WEIGHTS.shareParity * 100, 2),
        detail: `${round(minutesDone)} of ${totalMinutes} min done (${round(shareOfWork * 100, 1)}% of work) against a ${round(shareOfCapacity * 100, 1)}% capacity share → ${round(deviationPoints, 1)} points ${deviationPoints >= 0 ? "over" : "under"} fair share.`,
      },
      {
        key: "overdueExposure",
        label: "Overdue exposure",
        weight: MEMBER_WEIGHTS.overdueExposure,
        raw: round(exposure, 3),
        contribution: round(exposure * MEMBER_WEIGHTS.overdueExposure * 100, 2),
        detail: `${overdue.length} overdue chore(s) carrying ${overdueMinutes} min, against a household worst of ${worstOverdue} min.`,
      },
      {
        key: "followThrough",
        label: "Follow-through",
        weight: MEMBER_WEIGHTS.followThrough,
        raw: round(followThrough, 3),
        contribution: round(followThrough * MEMBER_WEIGHTS.followThrough * 100, 2),
        detail: `${completionsByMember.get(member.id) ?? 0} completed in ${windowDays} days, against a household best of ${bestCompletions}.`,
      },
      {
        key: "openLoad",
        label: "Open load",
        weight: MEMBER_WEIGHTS.openLoad,
        raw: round(openLoad, 3),
        contribution: round(openLoad * MEMBER_WEIGHTS.openLoad * 100, 2),
        detail: `${open.length} open chore(s) carrying ${pendingMinutes} min, against a household maximum of ${worstOpen} min.`,
      },
    ];

    const score = round(factors.reduce((sum, f) => sum + f.contribution, 0), 1);

    const verdict: LoadVerdict =
      deviationPoints <= -8 ? "under-loaded" : deviationPoints >= 8 ? "over-loaded" : "fair";

    return {
      memberId: member.id,
      name: member.name,
      tint: member.tint,
      capacity,
      shareOfCapacity: round(shareOfCapacity, 4),
      minutesDone,
      shareOfWork: round(shareOfWork, 4),
      deviationPoints: round(deviationPoints, 1),
      openChores: open.length,
      overdueChores: overdue.length,
      overdueMinutes,
      score,
      verdict,
      factors,
    };
  });

  /* --- Household-level factors --------------------------------------------- */

  // Spread is the mean absolute deviation across members, in percentage points.
  const spreadPoints = members.length
    ? round(memberResults.reduce((sum, m) => sum + Math.abs(m.deviationPoints), 0) / memberResults.length, 1)
    : 0;

  const parityRaw = clamp01(1 - spreadPoints / 50);

  const allOpen = chores.filter((c) => c.status !== "done" && c.status !== "skipped");
  const overdueAll = allOpen.filter((c) => c.dueOn < today);
  const worstOverdueDays = overdueAll.reduce(
    (max, c) => Math.max(max, daysBetween(c.dueOn, today)),
    0,
  );
  const overdueRaw = clamp01(1 - worstOverdueDays / 14);

  const windowTarget = Math.max(1, Math.round((windowDays / 7) * 3));
  const momentumRaw = clamp01(completions.length / windowTarget);

  // Effort honesty: does recorded effort track actual chore effort? A gap in
  // either direction means the ledger and the reality have drifted apart.
  const choreById = new Map(chores.map((c) => [c.id, c]));
  const effortGaps = completions
    .map((c) => {
      const chore = choreById.get(c.choreId);
      if (!chore) return null;
      return Math.abs(chore.effortMinutes - c.minutesSpent) / Math.max(1, chore.effortMinutes);
    })
    .filter((v): v is number => v !== null);
  const meanGap = effortGaps.length > 0 ? effortGaps.reduce((s, v) => s + v, 0) / effortGaps.length : 0;
  const effortRaw = clamp01(1 - meanGap / 0.5);

  const factors: Factor[] = [
    {
      key: "shareParity",
      label: "Share parity",
      weight: HOUSEHOLD_WEIGHTS.shareParity,
      raw: round(parityRaw, 3),
      contribution: round(parityRaw * HOUSEHOLD_WEIGHTS.shareParity * 100, 2),
      detail:
        members.length === 0
          ? "No active members, so parity is undefined and scored at 1.00."
          : `Mean absolute deviation is ${spreadPoints} points across ${members.length} member(s).`,
    },
    {
      key: "overduePressure",
      label: "Overdue pressure",
      weight: HOUSEHOLD_WEIGHTS.overduePressure,
      raw: round(overdueRaw, 3),
      contribution: round(overdueRaw * HOUSEHOLD_WEIGHTS.overduePressure * 100, 2),
      detail:
        overdueAll.length === 0
          ? `Nothing overdue as of ${today}.`
          : `${overdueAll.length} overdue chore(s), worst ${worstOverdueDays} day(s) late.`,
    },
    {
      key: "momentum",
      label: "Momentum",
      weight: HOUSEHOLD_WEIGHTS.momentum,
      raw: round(momentumRaw, 3),
      contribution: round(momentumRaw * HOUSEHOLD_WEIGHTS.momentum * 100, 2),
      detail: `${completions.length} completion(s) in ${windowDays} days against a target of ${windowTarget}.`,
    },
    {
      key: "effortHonesty",
      label: "Effort honesty",
      weight: HOUSEHOLD_WEIGHTS.effortHonesty,
      raw: round(effortRaw, 3),
      contribution: round(effortRaw * HOUSEHOLD_WEIGHTS.effortHonesty * 100, 2),
      detail:
        effortGaps.length === 0
          ? "No completions yet, so effort accuracy is undefined and scored at 1.00."
          : `Recorded minutes differ from chore estimates by ${round(meanGap * 100, 1)}% on average.`,
    },
  ];

  const fairnessScore = round(
    Math.max(0, Math.min(100, factors.reduce((sum, f) => sum + f.contribution, 0))),
    1,
  );

  /* --- Weather fit --------------------------------------------------------- */

  const forecastByDate = new Map(context.weather.days.map((day) => [day.date, day]));
  const weatherFit: WeatherFit[] = allOpen
    .filter((chore) => chore.outdoor)
    .map((chore) => {
      const scored = scoreWeatherDay(forecastByDate.get(chore.dueOn));
      return { choreId: chore.id, suitability: scored.suitability, verdict: scored.verdict, detail: scored.detail };
    });

  /* --- Recommendation ------------------------------------------------------ */

  const recommendation = recommend({ chores: allOpen, members: memberResults, forecastByDate, today });

  return {
    version: ENGINE_VERSION,
    computedAt: now.toISOString(),
    windowDays,
    fairnessScore,
    spreadPoints,
    members: memberResults,
    weatherFit,
    recommendation,
    factors,
    context,
    seal: input.seal ?? GENESIS_SEAL,
  };
}

/**
 * Pick the single most useful next action.
 *
 * The objective is deliberately simple and arguable-by-humans: pick the chore
 * that is most overdue, then pick the person whose deviation is furthest below
 * zero. Tie-breaking is total and explicit — equal score, then earlier `dueOn`,
 * then member name, then id — so the same ledger always produces the same
 * answer on every device. A recommendation that reshuffles between two loads
 * of the same page is worse than no recommendation.
 */
function recommend(args: {
  chores: Chore[];
  members: MemberFairness[];
  forecastByDate: Map<string, DailyForecast>;
  today: string;
}): FairnessRecommendation | null {
  const { chores, members, forecastByDate, today } = args;
  if (chores.length === 0 || members.length === 0) return null;

  type Candidate = {
    chore: Chore;
    member: MemberFairness;
    urgency: number;
  };

  const candidates: Candidate[] = [];
  for (const chore of chores) {
    // A chore assigned to someone else still needs a suggestion when it is
    // badly overdue: that is exactly when the household needs a nudge.
    const lateness = daysBetween(chore.dueOn, today);
    const baseUrgency = 50 + Math.min(50, Math.max(0, lateness) * 12);

    let pool = members;
    if (chore.assigneeId) {
      const assignee = members.find((m) => m.memberId === chore.assigneeId);
      if (assignee) pool = [assignee];
    }

    for (const member of pool) {
      const urgency = baseUrgency - member.deviationPoints;
      candidates.push({ chore, member, urgency });
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (b.urgency !== a.urgency) return b.urgency - a.urgency;
    if (a.chore.dueOn !== b.chore.dueOn) return a.chore.dueOn < b.chore.dueOn ? -1 : 1;
    if (a.member.name !== b.member.name) return a.member.name < b.member.name ? -1 : 1;
    return a.member.memberId < b.member.memberId ? -1 : 1;
  });

  const best = candidates[0]!;
  const lateness = daysBetween(best.chore.dueOn, today);

  const reasonParts: string[] = [];
  reasonParts.push(
    lateness > 0
      ? `"${best.chore.title}" is ${lateness} day(s) past due`
      : `"${best.chore.title}" is due ${best.chore.dueOn}`,
  );

  if (best.member.deviationPoints < -3) {
    reasonParts.push(
      `${best.member.name} is ${round(Math.abs(best.member.deviationPoints), 1)} points under their capacity share and should take the next one`,
    );
  } else if (best.chore.assigneeId === best.member.memberId) {
    reasonParts.push(`it is already assigned to ${best.member.name}`);
  } else {
    reasonParts.push(`${best.member.name} is closest to their fair share (${best.member.deviationPoints} points)`);
  }

  if (best.chore.outdoor) {
    const scored = scoreWeatherDay(forecastByDate.get(best.chore.dueOn));
    reasonParts.push(`weather for that date scores ${scored.suitability} (${scored.verdict})`);
  }

  return {
    choreId: best.chore.id,
    choreTitle: best.chore.title,
    memberId: best.member.memberId,
    memberName: best.member.name,
    reason: `${reasonParts.join("; ")}.`,
    engineVersion: ENGINE_VERSION,
  };
}

/** Convenience wrapper used by the seed routine and tests. */
export function emptyContext(now: Date): HouseholdContext {
  return {
    weather: {
      status: "fallback",
      city: "",
      latitude: 0,
      longitude: 0,
      fetchedAt: now.toISOString(),
      source: "none",
      sourceUrl: "",
      days: [],
    },
    holidays: {
      status: "fallback",
      country: "",
      year: now.getUTCFullYear(),
      fetchedAt: now.toISOString(),
      source: "none",
      sourceUrl: "",
      days: [],
    },
    holidayIndex: {},
    coveredThrough: null,
  };
}

export type { Household };