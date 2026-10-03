/**
 * Service layer.
 *
 * Every write in Griha goes through exactly one of these functions. The board
 * UI, the REST endpoints and the MCP tools all call them, which is what makes
 * the claim in the README true: an agent mutation and a button press take the
 * identical path, append the identical audit event, and return the identical
 * seal.
 *
 * Nothing in here imports from `next/headers`. The caller supplies the owner
 * scope, so the same code runs in a Route Handler, a Server Component and a
 * test without a request object.
 */

import { randomUUID } from "node:crypto";
import { computeFairness, ENGINE_VERSION, emptyContext } from "./engine";
import { getHouseholdContext } from "./context";
import type { Repository } from "./repository";
import type {
  AuditAction,
  AuditEvent,
  Chore,
  Completion,
  CreateChoreInput,
  CreateMemberInput,
  FairnessResult,
  Household,
  Member,
  UpdateChoreInput,
} from "./types";
import { NotFoundError } from "./errors";

export interface HouseholdBundle {
  household: Household;
  members: Member[];
  chores: Chore[];
  completions: Completion[];
}

const WINDOW_DAYS = 28;

function windowStartIso(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/* Bootstrap and seeding                                                       */
/* -------------------------------------------------------------------------- */

export interface SeedPlan {
  members: Array<CreateMemberInput>;
  chores: Array<CreateChoreInput & { assigneeIndex?: number }>;
  /** `daysAgo` is relative to seed time, so the demo is never stale. */
  completions: Array<{ choreIndex: number; memberIndex: number; daysAgo: number; minutesSpent: number }>;
}

const TINTS = ["terracotta", "verdigris", "indigo", "saffron", "madder"] as const;

/**
 * First-run household.
 *
 * This exists so a visitor lands on a board with real content instead of an
 * empty state they have to imagine. Seed rows use the caller's owner scope and
 * are created only once per session, so they can never collide with rows a real
 * user creates afterwards.
 *
 * The completion history is deliberately *not* random and deliberately *not*
 * flawless. A four-week household history always contains lapses: chores that
 * were assigned, ran past their due date and were never done. Without those the
 * TabPFN training table would hold a single class — every example the same
 * answer — and the model would correctly refuse to fit it. Inventing a spotless
 * record would make the demo look tidier than any real home, and would make the
 * ML panel inoperative on the first screen anyone sees.
 *
 * So two chores are seeded as genuinely missed: assigned, overdue, still open.
 */
export function buildSeedPlan(now: Date): SeedPlan {
  const iso = (daysFromNow: number) =>
    new Date(now.getTime() + daysFromNow * 86_400_000).toISOString().slice(0, 10);

  return {
    members: [
      { name: "Aarav", capacity: 1, tint: TINTS[0] },
      { name: "Ishita", capacity: 1.4, tint: TINTS[1] },
      { name: "Nani", capacity: 0.7, tint: TINTS[2] },
    ],
    chores: [
      // -- two lapses: assigned, past due, never completed ------------------
      { title: "Reseal the bathroom window", category: "maintenance", effortMinutes: 25, dueOn: iso(-6), assigneeIndex: 1, outdoor: false, note: "Sealant is in the hall cupboard." },
      { title: "Replace the corridor bulb", category: "maintenance", effortMinutes: 10, dueOn: iso(-3), assigneeIndex: 0, outdoor: false, note: "E27, from the hardware shelf." },

      // -- the live board --------------------------------------------------
      { title: "Take out the recycling", category: "admin", effortMinutes: 10, dueOn: iso(-2), assigneeIndex: 2, outdoor: true, note: "Blue bin by the gate." },
      { title: "Wash the breakfast dishes", category: "kitchen", effortMinutes: 15, dueOn: iso(-1), assigneeIndex: 1, outdoor: false, note: "Soak the kadhai overnight." },
      { title: "Water the tulsi", category: "outdoor", effortMinutes: 5, dueOn: iso(0), assigneeIndex: 2, outdoor: true, note: "Morning light only." },
      { title: "Change the bed linen", category: "laundry", effortMinutes: 20, dueOn: iso(0), assigneeIndex: 1, outdoor: false, note: "Two sets in the dryer." },
      { title: "Mop the kitchen floor", category: "cleaning", effortMinutes: 25, dueOn: iso(1), assigneeIndex: 0, outdoor: false, note: "After dinner, not before." },
      { title: "Clean the geyser vent", category: "maintenance", effortMinutes: 30, dueOn: iso(2), outdoor: false, note: "Unplug first." },
      { title: "Buy milk and curd", category: "shopping", effortMinutes: 20, dueOn: iso(2), outdoor: true, note: "The corner shop closes at 9." },
      { title: "Clean the balcony plants", category: "outdoor", effortMinutes: 15, dueOn: iso(3), outdoor: true, note: "Skip in heavy rain." },
    ],
    completions: [
      { choreIndex: 2, memberIndex: 1, daysAgo: 5, minutesSpent: 10 },
      { choreIndex: 3, memberIndex: 0, daysAgo: 6, minutesSpent: 18 },
      { choreIndex: 4, memberIndex: 2, daysAgo: 4, minutesSpent: 5 },
      { choreIndex: 5, memberIndex: 1, daysAgo: 6, minutesSpent: 22 },
      { choreIndex: 6, memberIndex: 0, daysAgo: 8, minutesSpent: 25 },
      { choreIndex: 2, memberIndex: 0, daysAgo: 12, minutesSpent: 10 },
      { choreIndex: 3, memberIndex: 1, daysAgo: 13, minutesSpent: 15 },
      { choreIndex: 6, memberIndex: 2, daysAgo: 15, minutesSpent: 30 },
      { choreIndex: 5, memberIndex: 2, daysAgo: 17, minutesSpent: 20 },
      { choreIndex: 2, memberIndex: 2, daysAgo: 19, minutesSpent: 12 },
      { choreIndex: 3, memberIndex: 0, daysAgo: 20, minutesSpent: 16 },
      { choreIndex: 6, memberIndex: 1, daysAgo: 22, minutesSpent: 28 },
      { choreIndex: 4, memberIndex: 1, daysAgo: 24, minutesSpent: 6 },
      { choreIndex: 5, memberIndex: 0, daysAgo: 25, minutesSpent: 20 },
    ],
  };
}

/**
 * Ensure the caller owns a household, seeding one on first contact.
 *
 * Returns the household alongside a `seeded` flag so the UI can say "here is a
 * starter board" honestly rather than implying the user created it.
 *
 * The whole seed is written through `seedHousehold`, which does four bulk
 * inserts in one transaction. Writing it row by row meant ~75 sequential HTTP
 * round trips to the database on a serverless driver, which made the very first
 * page load take over a minute.
 */
export async function ensureHousehold(
  repo: Repository,
  ownerId: string,
  input: { name: string; city: string; country: string },
  now: Date,
): Promise<{ household: Household; seeded: boolean }> {
  const existing = await repo.getHousehold(ownerId);
  if (existing) return { household: existing, seeded: false };

  const household = await repo.createHousehold(ownerId, input);
  const plan = buildSeedPlan(now);

  const memberIds: string[] = [];
  const choreIds: string[] = [];
  const events: Array<{ id: string; action: AuditAction; payload: unknown }> = [];

  events.push({
    id: randomUUID(),
    action: "household.created",
    payload: { name: household.name, city: household.city, country: household.country },
  });

  for (const member of plan.members) {
    memberIds.push(randomUUID());
    events.push({
      id: randomUUID(),
      action: "member.created",
      payload: { name: member.name, capacity: member.capacity ?? 1, seed: true },
    });
  }

  for (const chore of plan.chores) {
    choreIds.push(randomUUID());
    events.push({
      id: randomUUID(),
      action: "chore.created",
      payload: {
        title: chore.title,
        category: chore.category,
        effortMinutes: chore.effortMinutes,
        dueOn: chore.dueOn,
        outdoor: chore.outdoor,
        seed: true,
      },
    });
  }

  for (const entry of plan.completions) {
    const choreId = choreIds[entry.choreIndex];
    const memberId = memberIds[entry.memberIndex];
    if (!choreId || !memberId) continue;
    const completedOn = new Date(now.getTime() - entry.daysAgo * 86_400_000).toISOString().slice(0, 10);
    events.push({
      id: randomUUID(),
      action: "chore.completed",
      payload: { choreId, memberId, completedOn, minutesSpent: entry.minutesSpent, seed: true },
    });
  }

  await repo.seedHousehold({
    householdId: household.id,
    ownerId,
    members: plan.members.map((m, i) => ({
      id: memberIds[i]!,
      name: m.name,
      capacity: m.capacity ?? 1,
      tint: m.tint ?? "terracotta",
    })),
    chores: plan.chores.map((c, i) => ({
      id: choreIds[i]!,
      title: c.title,
      category: c.category,
      effortMinutes: c.effortMinutes,
      dueOn: c.dueOn,
      outdoor: c.outdoor ?? false,
      note: c.note ?? "",
      assigneeId: c.assigneeIndex === undefined ? null : (memberIds[c.assigneeIndex] ?? null),
    })),
    completions: plan.completions
      .map((entry) => ({
        id: randomUUID(),
        choreId: choreIds[entry.choreIndex]!,
        memberId: memberIds[entry.memberIndex]!,
        completedOn: new Date(now.getTime() - entry.daysAgo * 86_400_000)
          .toISOString()
          .slice(0, 10),
        minutesSpent: entry.minutesSpent,
      }))
      .filter((c) => Boolean(c.choreId && c.memberId)),
    events,
  });

return { household, seeded: true };
}

/**
 * Scope for the single shared demo household shown to visitors who have not
 * started a board yet. It is one row, seeded once, and read-only from the
 * landing page — it is never what a real visitor's board resolves to.
 */
export const DEMO_SCOPE = "griha-public-demo";

export async function ensureDemoHousehold(
  repo: Repository,
  now: Date,
): Promise<{ household: Household; seeded: boolean }> {
  return ensureHousehold(
    repo,
    DEMO_SCOPE,
    { name: "The Adak household", city: "New Delhi", country: "IN" },
    now,
  );
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function loadBundle(repo: Repository, ownerId: string): Promise<HouseholdBundle> {
  const household = await repo.getHousehold(ownerId);
  if (!household) throw new NotFoundError("No household exists for this session yet.");

  const [members, chorePage, completions] = await Promise.all([
    repo.listMembers(household.id),
    repo.listChores(household.id, 200, 0),
    repo.listCompletions(household.id, windowStartIso(new Date(), WINDOW_DAYS)),
  ]);

  return { household, members, chores: chorePage.items, completions };
}

export async function loadBundleByShareToken(repo: Repository, token: string): Promise<HouseholdBundle> {
  const household = await repo.getHouseholdByShareToken(token);
  if (!household) throw new NotFoundError("That share link does not match any household.");

  const [members, chorePage, completions] = await Promise.all([
    repo.listMembers(household.id),
    repo.listChores(household.id, 200, 0),
    repo.listCompletions(household.id, windowStartIso(new Date(), WINDOW_DAYS)),
  ]);

  return { household, members, chores: chorePage.items, completions };
}

/**
 * Run the fairness engine for a household.
 *
 * `fetchContext: false` skips the two upstream calls. The agent console and the
 * export centre use it because they already hold a context, and it keeps the
 * tool latency predictable.
 */
export async function computeHouseholdFairness(
  repo: Repository,
  bundle: HouseholdBundle,
  now: Date,
  options: { fetchContext?: boolean; context?: FairnessResult["context"] } = {},
): Promise<FairnessResult> {
  const seal = await repo.headSeal(bundle.household.id);

  let context = options.context;
  if (!context) {
    context = options.fetchContext === false
      ? emptyContext(now)
      : await getHouseholdContext(bundle.household.city, bundle.household.country);
  }

  return computeFairness({
    household: bundle.household,
    members: bundle.members,
    chores: bundle.chores,
    completions: bundle.completions,
    context,
    now,
    seal,
  });
}

/* -------------------------------------------------------------------------- */
/* Writes — every one of these is the only path to a mutation                 */
/* -------------------------------------------------------------------------- */

export interface WriteResult<T> {
  value: T;
  event: AuditEvent;
}

export async function createChore(
  repo: Repository,
  ownerId: string,
  householdId: string,
  input: CreateChoreInput,
): Promise<WriteResult<Chore>> {
  const chore = await repo.createChore(householdId, ownerId, input);
  const event = await repo.appendAudit(
    householdId,
    "chore.created",
    { choreId: chore.id, title: chore.title, category: chore.category, effortMinutes: chore.effortMinutes, dueOn: chore.dueOn, outdoor: chore.outdoor, idempotencyKey: input.idempotencyKey ?? null },
    ownerId,
  );
  return { value: chore, event };
}

export async function updateChore(
  repo: Repository,
  ownerId: string,
  householdId: string,
  id: string,
  input: UpdateChoreInput,
): Promise<WriteResult<Chore>> {
  const chore = await repo.updateChore(householdId, id, input);
  if (!chore) throw new NotFoundError(`No chore with id ${id} in this household.`);

  const action = input.status === "skipped" ? "chore.skipped" : input.status === "claimed" ? "chore.claimed" : "chore.updated";
  const event = await repo.appendAudit(
    householdId,
    action,
    {
      choreId: chore.id,
      title: chore.title,
      assigneeId: chore.assigneeId,
      status: chore.status,
      dueOn: chore.dueOn,
      effortMinutes: chore.effortMinutes,
      idempotencyKey: input.idempotencyKey ?? null,
    },
    ownerId,
  );
  return { value: chore, event };
}

export async function claimChore(
  repo: Repository,
  ownerId: string,
  householdId: string,
  id: string,
  memberId: string,
): Promise<WriteResult<Chore>> {
  return updateChore(repo, ownerId, householdId, id, { assigneeId: memberId, status: "claimed" });
}

export async function completeChore(
  repo: Repository,
  ownerId: string,
  householdId: string,
  id: string,
  input: { memberId: string; minutesSpent?: number; completedOn?: string },
): Promise<WriteResult<{ chore: Chore; completion: Completion; event: AuditEvent }>> {
  const current = await repo.getChore(householdId, id);
  if (!current) throw new NotFoundError(`No chore with id ${id} in this household.`);

  const now = new Date();
  const completedOn = input.completedOn ?? now.toISOString().slice(0, 10);
  const minutesSpent = input.minutesSpent ?? current.effortMinutes;

  const completion = await repo.recordCompletion(householdId, {
    choreId: id,
    memberId: input.memberId,
    completedOn,
    minutesSpent,
  });

  const chore = await repo.updateChore(householdId, id, { status: "done", assigneeId: input.memberId });

  const event = await repo.appendAudit(
    householdId,
    "chore.completed",
    { choreId: id, memberId: input.memberId, completedOn, minutesSpent, completionId: completion.id },
    ownerId,
  );

  return { value: { chore: chore!, completion, event }, event };
}

export async function deleteChore(
  repo: Repository,
  ownerId: string,
  householdId: string,
  id: string,
): Promise<WriteResult<Chore>> {
  const chore = await repo.deleteChore(householdId, id);
  if (!chore) throw new NotFoundError(`No chore with id ${id} in this household.`);

  const event = await repo.appendAudit(householdId, "chore.deleted", { choreId: id, title: chore.title }, ownerId);
  return { value: chore, event };
}

export async function createMember(
  repo: Repository,
  ownerId: string,
  householdId: string,
  input: CreateMemberInput,
): Promise<WriteResult<Member>> {
  const member = await repo.createMember(householdId, ownerId, input);
  const event = await repo.appendAudit(householdId, "member.created", { memberId: member.id, name: member.name, capacity: member.capacity }, ownerId);
  return { value: member, event };
}

export async function updateMember(
  repo: Repository,
  ownerId: string,
  householdId: string,
  id: string,
  input: Partial<{ name: string; capacity: number; tint: string }>,
): Promise<WriteResult<Member>> {
  const member = await repo.updateMember(householdId, id, input);
  if (!member) throw new NotFoundError(`No member with id ${id} in this household.`);
  const event = await repo.appendAudit(householdId, "member.updated", { memberId: member.id, name: member.name, capacity: member.capacity, tint: member.tint }, ownerId);
  return { value: member, event };
}

export async function updateHousehold(
  repo: Repository,
  ownerId: string,
  householdId: string,
  input: Partial<{ name: string; city: string; country: string }>,
): Promise<WriteResult<Household>> {
  const household = await repo.updateHousehold(ownerId, householdId, input);
  if (!household) throw new NotFoundError("No household exists for this session.");
  const event = await repo.appendAudit(
    householdId,
    "household.updated",
    { name: household.name, city: household.city, country: household.country },
    ownerId,
  );
  return { value: household, event };
}

export { ENGINE_VERSION };