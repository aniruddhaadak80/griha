import { ENGINE_VERSION } from "@/lib/engine";
import { fail, ok } from "@/lib/errors";
import { LIMITS, requireCountry, requireString, ValidationError } from "@/lib/validation";
import { assertWriteAllowed, resolveHousehold } from "@/lib/server";
import { updateHousehold } from "@/lib/service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const resolved = await resolveHousehold(request);
    if (!resolved) return fail(new Error("No household for this session."));
    return ok({ household: resolved.household }, { engineVersion: ENGINE_VERSION });
  } catch (error) {
    return fail(error);
  }
}

/**
 * Update the household.
 *
 * The API token and the share token are deliberately not editable here. Both
 * are capability grants; making them changeable from an endpoint that the same
 * browser session can call would mean a single CSRF-adjacent bug could
 * re-issue write access to anyone.
 */
export async function PATCH(request: Request) {
  try {
    assertWriteAllowed(request);
    const resolved = await resolveHousehold(request, { requireExisting: true });
    if (!resolved) return fail(new Error("No household for this session."));

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new ValidationError("body", "Send a JSON object body.");

    const result = await updateHousehold(resolved.repo, resolved.ownerId, resolved.household.id, {
      name: body.name !== undefined ? requireString(body.name, "name", { min: 1, max: LIMITS.householdName }) : undefined,
      city: body.city !== undefined ? requireString(body.city, "city", { min: 1, max: LIMITS.city }) : undefined,
      country: body.country !== undefined ? requireCountry(body.country, "country") : undefined,
    });

    return ok(
      {
        household: {
          id: result.value.id,
          name: result.value.name,
          city: result.value.city,
          country: result.value.country,
        },
      },
      { seal: result.event.seal, engineVersion: ENGINE_VERSION },
    );
  } catch (error) {
    return fail(error);
  }
}