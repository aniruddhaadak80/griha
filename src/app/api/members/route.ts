import { ENGINE_VERSION } from "@/lib/engine";
import { created, fail, ok } from "@/lib/errors";
import { LIMITS, ValidationError, optionalNumber, optionalString, requireNumber, requireString } from "@/lib/validation";
import { assertWriteAllowed, resolveHousehold } from "@/lib/server";
import { createMember, updateMember } from "@/lib/service";
import { requireId } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const resolved = await resolveHousehold(request);
    if (!resolved) return ok({ members: [] });
    return ok({ members: resolved.bundle.members }, { engineVersion: ENGINE_VERSION });
  } catch (error) {
    return fail(error);
  }
}

/**
 * Add a member.
 *
 * `capacity` is the fairness knob that makes the engine honest: a household of
 * three where one person works nights should not score as unfair just because
 * they physically cannot do more. It is bounded to 0.2–3.0 so one member cannot
 * be assigned a share so large the arithmetic becomes meaningless.
 */
export async function POST(request: Request) {
  try {
    assertWriteAllowed(request);
    const resolved = await resolveHousehold(request);
    if (!resolved) return fail(new Error("No household for this session."));

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new ValidationError("body", "Send a JSON object body.");

    const result = await createMember(resolved.repo, resolved.ownerId, resolved.household.id, {
      name: requireString(body.name, "name", { min: 1, max: LIMITS.memberName }),
      capacity: optionalNumber(body.capacity, "capacity", { min: LIMITS.capacityMin, max: LIMITS.capacityMax }) ?? 1,
      tint: optionalString(body.tint, "tint", { max: 24 }) ?? "terracotta",
    });

    return created(result.value, { seal: result.event.seal, engineVersion: ENGINE_VERSION });
  } catch (error) {
    return fail(error);
  }
}

/** Update a member's name, capacity or tint. */
export async function PATCH(request: Request) {
  try {
    assertWriteAllowed(request);
    const resolved = await resolveHousehold(request, { requireExisting: true });
    if (!resolved) return fail(new Error("No household for this session."));

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new ValidationError("body", "Send a JSON object body.");

    const memberId = requireString(body.memberId, "memberId", { min: 8, max: 64 });

    const result = await updateMember(resolved.repo, resolved.ownerId, resolved.household.id, requireId(memberId, "memberId"), {
      name: body.name !== undefined ? requireString(body.name, "name", { min: 1, max: LIMITS.memberName }) : undefined,
      capacity: body.capacity !== undefined ? requireNumber(body.capacity, "capacity", { min: LIMITS.capacityMin, max: LIMITS.capacityMax }) : undefined,
      tint: optionalString(body.tint, "tint", { max: 24 }),
    });

    return ok(result.value, { seal: result.event.seal, engineVersion: ENGINE_VERSION });
  } catch (error) {
    return fail(error);
  }
}