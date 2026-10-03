import { ENGINE_VERSION } from "@/lib/engine";
import { created, fail, ok } from "@/lib/errors";
import type { ChoreListResponse } from "@/lib/api-types";
import { assertWriteAllowed, resolveHousehold } from "@/lib/server";
import { createChore } from "@/lib/service";
import {
  LIMITS,
  ValidationError,
  optionalBoolean,
  optionalId,
  optionalString,
  parseChoreCategory,
  requireInt,
  requireIsoDate,
  requireString,
} from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const resolved = await resolveHousehold(request);
    if (!resolved) return fail(new Error("No household for this session."));

    const payload: ChoreListResponse = {
      chores: resolved.bundle.chores,
      total: resolved.bundle.chores.length,
      members: resolved.bundle.members,
      household: resolved.household,
      completions: resolved.bundle.completions,
    };

    return ok(payload, { engineVersion: ENGINE_VERSION });
  } catch (error) {
    return fail(error);
  }
}

/**
 * Create a chore.
 *
 * `idempotencyKey` makes retries safe for agents: replaying the same request
 * returns the same row rather than duplicating a chore. The key is validated
 * for length and character set before it reaches the database.
 */
export async function POST(request: Request) {
  try {
    assertWriteAllowed(request);
    const resolved = await resolveHousehold(request);
    if (!resolved) return fail(new Error("No household for this session."));

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new ValidationError("body", "Send a JSON object body.");

    const assigneeId = optionalId(body.assigneeId, "assigneeId");
    if (assigneeId && !resolved.bundle.members.some((m) => m.id === assigneeId)) {
      throw new ValidationError("assigneeId", "That member does not belong to this household.");
    }

    const input = {
      title: requireString(body.title, "title", { min: 2, max: LIMITS.choreTitle }),
      category: parseChoreCategory(body.category),
      effortMinutes: requireInt(body.effortMinutes, "effortMinutes", { min: 1, max: LIMITS.effortMinutesMax }),
      dueOn: requireIsoDate(body.dueOn, "dueOn"),
      assigneeId: assigneeId ?? null,
      outdoor: optionalBoolean(body.outdoor, "outdoor") ?? false,
      note: optionalString(body.note, "note", { max: LIMITS.choreNote }) ?? "",
      idempotencyKey: body.idempotencyKey
        ? requireString(body.idempotencyKey, "idempotencyKey", { min: 8, max: LIMITS.idempotencyKey })
        : undefined,
    };

    const result = await createChore(resolved.repo, resolved.ownerId, resolved.household.id, input);

    return created(result.value, { seal: result.event.seal, engineVersion: ENGINE_VERSION });
  } catch (error) {
    return fail(error);
  }
}