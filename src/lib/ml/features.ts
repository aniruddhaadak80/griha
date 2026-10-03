/**
 * Turning a household's own history into a TabPFN training table.
 *
 * This module is deliberately pure and framework-free: it takes records, returns
 * numbers. That means the feature construction — the part that is easy to get
 * subtly wrong and impossible to eyeball — is unit tested, and the browser only
 * has to hand the rows to the model.
 *
 * What the model is actually predicting, stated plainly:
 *
 *   "Given this chore, on this date, with this effort, assigned to this person
 *    at this point in their load — did it get done?"
 *
 * Rows are built from two real populations, not one:
 *   - label 1: every recorded completion, with the features as they were on the
 *     day it happened;
 *   - label 0: every chore whose due date has passed and which was never
 *     completed. Without these the model would only ever learn "things people
 *     finished get finished", which is true and useless.
 *
 * Nothing here is random and nothing is synthesised. A household with no history
 * produces no table, and the UI says so instead of showing made-up numbers.
 */

import type { Chore, Completion, HouseholdContext, Member } from "../types";
import { TABPFN_FEATURES } from "../types";

export interface FeatureRow {
  features: number[];
  label: 1 | 0;
  choreTitle: string;
  memberName: string;
  date: string;
  /** What the row represents, so the UI can show the model its own evidence. */
  origin: "completed" | "missed";
}

const CHORE_COUNT = 500;

/** ISO date -> weekday index, 0 = Sunday. Returns -1 for an unparseable date. */
function weekdayIndex(iso: string): number {
  const parsed = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return -1;
  return new Date(parsed).getUTCDay();
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

/** Clamp to a sane numeric range so one outlier cannot dominate the fit. */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

interface Shared {
  members: Member[];
  memberById: Map<string, Member>;
  /** Category -> how many times each member completed it, for the share feature. */
  categoryCounts: Map<string, Map<string, number>>;
  /** Member -> sorted completion dates, for the recency feature. */
  completionDates: Map<string, string[]>;
  totalCapacity: number;
}

function buildShared(members: Member[], completions: Completion[], chores: Chore[]): Shared {
  const memberById = new Map(members.map((m) => [m.id, m]));
  const categoryCounts = new Map<string, Map<string, number>>();
  const completionDates = new Map<string, string[]>();
  const choreById = new Map(chores.map((c) => [c.id, c]));

  for (const member of members) {
    completionDates.set(member.id, []);
    categoryCounts.set(member.id, new Map());
  }

  for (const completion of completions) {
    const dates = completionDates.get(completion.memberId);
    if (dates) dates.push(completion.completedOn);

    const chore = choreById.get(completion.choreId);
    if (!chore) continue;
    const counts = categoryCounts.get(completion.memberId);
    if (!counts) continue;
    counts.set(chore.category, (counts.get(chore.category) ?? 0) + 1);
  }

  const totalCapacity = members.reduce((sum, m) => sum + (m.capacity > 0 ? m.capacity : 1), 0);

  return { members, memberById, categoryCounts, completionDates, totalCapacity: totalCapacity || 1 };
}

/** The eight features, in the exact order declared by `TABPFN_FEATURES`. */
function featureVector(
  shared: Shared,
  member: Member,
  chore: Chore,
  dateIso: string,
  context: HouseholdContext,
  assigneeId: string | null,
  assigneeLoadShare: number,
): number[] {
  const categoryCounts = shared.categoryCounts.get(member.id);
  const categoryTotal = [...(categoryCounts?.values() ?? [])].reduce((a, b) => a + b, 0);
  const categoryShare = categoryTotal > 0 ? (categoryCounts?.get(chore.category) ?? 0) / categoryTotal : 0;

  const dates = (shared.completionDates.get(member.id) ?? []).filter((d) => d < dateIso);
  const lastInCategory = findLastInCategory(dates, chore.category, shared);
  const daysSince = lastInCategory ? daysBetween(lastInCategory, dateIso) : 30;

  return [
    clamp(member.capacity, 0.1, 3),
    clamp(categoryShare, 0, 1),
    clamp(chore.effortMinutes, 1, 240),
    weekdayIndex(dateIso) < 0 ? 6 : weekdayIndex(dateIso),
    clamp(daysSince, 0, 60),
    clamp(assigneeId === member.id ? assigneeLoadShare : 0, 0, 1),
    context.holidayIndex[dateIso] ? 1 : 0,
    chore.outdoor ? 1 : 0,
  ];
}

function findLastInCategory(
  datesBefore: string[],
  category: string,
  shared: Shared,
): string | null {
  if (!datesBefore.length) return null;
  // Approximate: the newest completion by this member, which is the dominant
  // signal. Refining this to per-category would need a per-category date index,
  // which is not worth the memory for the signal it adds.
  void category;
  void shared;
  return datesBefore[datesBefore.length - 1] ?? null;
}

/**
 * Build the labelled table.
 *
 * `today` bounds the negatives: a chore due in the future is not evidence that
 * anything was missed.
 */
export function buildTrainingTable(args: {
  members: Member[];
  chores: Chore[];
  completions: Completion[];
  context: HouseholdContext;
  today: string;
}): FeatureRow[] {
  const { members, chores, completions, context, today } = args;
  const rows: FeatureRow[] = [];

  if (members.length === 0) return rows;

  const shared = buildShared(members, completions, chores);
  const choreById = new Map(chores.map((c) => [c.id, c]));

  const totalMinutes = completions.reduce((sum, c) => sum + c.minutesSpent, 0);

  /* --- positives: things that were completed ---------------------------- */
  for (const completion of completions.slice(-CHORE_COUNT)) {
    const chore = choreById.get(completion.choreId);
    const member = shared.memberById.get(completion.memberId);
    if (!chore || !member) continue;

    const memberMinutes = completions
      .filter((c) => c.memberId === member.id)
      .reduce((sum, c) => sum + c.minutesSpent, 0);
    const loadShare = totalMinutes > 0 ? memberMinutes / totalMinutes : 0;

    rows.push({
      features: featureVector(shared, member, chore, completion.completedOn, context, member.id, loadShare),
      label: 1,
      choreTitle: chore.title,
      memberName: member.name,
      date: completion.completedOn,
      origin: "completed",
    });
  }

  /* --- negatives: due, past, and never done ----------------------------- */
  for (const chore of chores) {
    if (chore.status === "done" || chore.status === "skipped") continue;
    if (chore.dueOn > today || chore.dueOn.length === 0) continue;

    const assignee = chore.assigneeId ? shared.memberById.get(chore.assigneeId) : null;
    // Only judge the assignment that actually existed. An unclaimed chore is a
    // scheduling failure, not a person's failure to complete it.
    if (!assignee) continue;

    const memberMinutes = completions
      .filter((c) => c.memberId === assignee.id)
      .reduce((sum, c) => sum + c.minutesSpent, 0);
    const loadShare = totalMinutes > 0 ? memberMinutes / totalMinutes : 0;

    rows.push({
      features: featureVector(shared, assignee, chore, chore.dueOn, context, assignee.id, loadShare),
      label: 0,
      choreTitle: chore.title,
      memberName: assignee.name,
      date: chore.dueOn,
      origin: "missed",
    });
  }

  return rows;
}

export interface PredictionTarget {
  choreId: string;
  choreTitle: string;
  memberId: string;
  memberName: string;
  features: number[];
}

/** One row per open chore × member: who is most likely to actually do it. */
export function buildPredictionTargets(args: {
  members: Member[];
  chores: Chore[];
  completions: Completion[];
  context: HouseholdContext;
  today: string;
  /** Cap the cross-product so a large household cannot stall the WASM runtime. */
  maxTargets?: number;
}): PredictionTarget[] {
  const { members, chores, completions, context, today, maxTargets = 120 } = args;

  const open = chores
    .filter((c) => c.status !== "done" && c.status !== "skipped")
    .sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : a.id < b.id ? -1 : 1));

  if (members.length === 0 || open.length === 0) return [];

  const shared = buildShared(members, completions, chores);
  const totalMinutes = completions.reduce((sum, c) => sum + c.minutesSpent, 0);

  const targets: PredictionTarget[] = [];
  for (const chore of open) {
    for (const member of members) {
      const memberMinutes = completions
        .filter((c) => c.memberId === member.id)
        .reduce((sum, c) => sum + c.minutesSpent, 0);
      const loadShare = totalMinutes > 0 ? memberMinutes / totalMinutes : 0;
      const date = chore.dueOn > today ? today : chore.dueOn;

      targets.push({
        choreId: chore.id,
        choreTitle: chore.title,
        memberId: member.id,
        memberName: member.name,
        features: featureVector(shared, member, chore, date, context, chore.assigneeId, loadShare),
      });
      if (targets.length >= maxTargets) return targets;
    }
  }

  return targets;
}

export { TABPFN_FEATURES };

/**
 * Map a probability onto an honest band.
 *
 * The thresholds are deliberately wide and the labels deliberately plain. A
 * prior-fitted network on a few dozen rows is not confident about anything, and
 * the UI must not imply otherwise.
 */
export function bandFor(probability: number): "likely" | "uncertain" | "at-risk" {
  if (probability >= 0.7) return "likely";
  if (probability >= 0.4) return "uncertain";
  return "at-risk";
}