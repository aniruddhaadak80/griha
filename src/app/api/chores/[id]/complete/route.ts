import { ENGINE_VERSION } from "@/lib/engine";
import { NotFoundError, fail, ok } from "@/lib/errors";
import { assertWriteAllowed, resolveHousehold } from "@/lib/server";
import { completeChore } from "@/lib/service";
import { LIMITS, ValidationError, optionalId, optionalInt, optionalIsoDate, requireId } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * Complete a chore.
 *
 * This is the decisive action of the whole product: one tap writes a completion
 * row, flips the chore to `done`, and appends one sealed audit event. The
 * fairness ledger the user sees afterwards is computed from that row — nothing
 * is estimated on the client.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/chores/[id]/complete">) {
  try {
    assertWriteAllowed(request);
    const { id } = await ctx.params;
    const resolved = await resolveHousehold(request, { requireExisting: true });
    if (!resolved) throw new NotFoundError("No household for this session.");

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const memberId = optionalId(body.memberId, "memberId");
    if (!memberId) throw new ValidationError("memberId", "Say who did it: memberId is required.");
    if (!resolved.bundle.members.some((m) => m.id === memberId)) {
      throw new ValidationError("memberId", "That member does not belong to this household.");
    }

    const minutesSpent = optionalInt(body.minutesSpent, "minutesSpent", { min: 1, max: LIMITS.effortMinutesMax });

    const result = await completeChore(resolved.repo, resolved.ownerId, resolved.household.id, requireId(id, "id"), {
      memberId,
      ...(minutesSpent !== undefined ? { minutesSpent } : {}),
      ...(body.completedOn ? { completedOn: optionalIsoDate(body.completedOn, "completedOn")! } : {}),
    });

    return ok(
      { chore: result.value.chore, completion: result.value.completion },
      { seal: result.event.seal, engineVersion: ENGINE_VERSION },
    );
  } catch (error) {
    return fail(error);
  }
}