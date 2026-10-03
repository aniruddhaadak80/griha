import { ENGINE_VERSION } from "@/lib/engine";
import { NotFoundError, fail, ok } from "@/lib/errors";
import { assertWriteAllowed, resolveHousehold } from "@/lib/server";
import { deleteChore, updateChore } from "@/lib/service";
import {
  LIMITS,
  ValidationError,
  optionalBoolean,
  optionalEnum,
  optionalId,
  optionalInt,
  optionalIsoDate,
  optionalString,
  parseChoreCategory,
  requireId,
  requireString,
} from "@/lib/validation";
import { CHORE_STATUSES } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(request: Request, ctx: RouteContext<"/api/chores/[id]">) {
  try {
    const { id } = await ctx.params;
    const resolved = await resolveHousehold(request, { requireExisting: true });
    if (!resolved) throw new NotFoundError("No household for this session.");

    const chore = await resolved.repo.getChore(resolved.household.id, requireId(id, "id"));
    if (!chore) throw new NotFoundError(`No chore with id ${id}.`);

    return ok({ chore, household: resolved.household }, { engineVersion: ENGINE_VERSION });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/chores/[id]">) {
  try {
    assertWriteAllowed(request);
    const { id } = await ctx.params;
    const resolved = await resolveHousehold(request, { requireExisting: true });
    if (!resolved) throw new NotFoundError("No household for this session.");

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new ValidationError("body", "Send a JSON object body.");

    const assigneeId = optionalId(body.assigneeId, "assigneeId");
    if (assigneeId && !resolved.bundle.members.some((m) => m.id === assigneeId)) {
      throw new ValidationError("assigneeId", "That member does not belong to this household.");
    }

    const result = await updateChore(resolved.repo, resolved.ownerId, resolved.household.id, requireId(id, "id"), {
      title: body.title !== undefined ? requireString(body.title, "title", { min: 2, max: LIMITS.choreTitle }) : undefined,
      category: body.category !== undefined ? parseChoreCategory(body.category) : undefined,
      effortMinutes: optionalInt(body.effortMinutes, "effortMinutes", { min: 1, max: LIMITS.effortMinutesMax }),
      dueOn: optionalIsoDate(body.dueOn, "dueOn"),
      assigneeId,
      outdoor: optionalBoolean(body.outdoor, "outdoor"),
      note: optionalString(body.note, "note", { max: LIMITS.choreNote }),
      status: optionalEnum(body.status, "status", CHORE_STATUSES),
      idempotencyKey: body.idempotencyKey
        ? requireString(body.idempotencyKey, "idempotencyKey", { min: 8, max: LIMITS.idempotencyKey })
        : undefined,
    });

    return ok(result.value, { seal: result.event.seal, engineVersion: ENGINE_VERSION });
  } catch (error) {
    return fail(error);
  }
}

/**
 * Delete a chore.
 *
 * Soft delete: the row survives as a tombstone so the SHA-384 chain stays
 * replayable. A hard delete would silently orphan the audit trail and make
 * "nothing was ever deleted" indistinguishable from "the record is gone".
 */
export async function DELETE(request: Request, ctx: RouteContext<"/api/chores/[id]">) {
  try {
    assertWriteAllowed(request);
    const { id } = await ctx.params;
    const resolved = await resolveHousehold(request, { requireExisting: true });
    if (!resolved) throw new NotFoundError("No household for this session.");

    const result = await deleteChore(resolved.repo, resolved.ownerId, resolved.household.id, requireId(id, "id"));

    return ok(
      { choreId: result.value.id, deleted: true, tombstone: true },
      { seal: result.event.seal, engineVersion: ENGINE_VERSION },
    );
  } catch (error) {
    return fail(error);
  }
}