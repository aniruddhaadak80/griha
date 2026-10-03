import { getHouseholdContext } from "@/lib/context";
import { getRepository } from "@/lib/repository";
import { ok, fail } from "@/lib/errors";
import { peekSessionId } from "@/lib/session";
import { DEFAULT_HOUSEHOLD } from "@/lib/server";
import type { CityContextResponse } from "@/lib/api-types";

export const runtime = "nodejs";

/**
 * Live context: the weather and public-holiday feeds the engine scores against.
 *
 * Returns `status: "live" | "fallback"` for each feed separately, and always
 * includes the upstream URL and fetch time, so a client can tell exactly which
 * numbers came off the network and which came from the sealed sample.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const repo = await getRepository();

    const ownerId = await peekSessionId();
    const household = ownerId ? await repo.getHousehold(ownerId) : null;

    const city = url.searchParams.get("city")?.trim() || household?.city || DEFAULT_HOUSEHOLD.city;
    const country =
      url.searchParams.get("country")?.trim().toUpperCase() || household?.country || DEFAULT_HOUSEHOLD.country;

    const context = await getHouseholdContext(city, country);

    const payload: CityContextResponse = {
      context,
      live: context.weather.status === "live" || context.holidays.status === "live",
    };

    return ok(payload);
  } catch (error) {
    return fail(error);
  }
}