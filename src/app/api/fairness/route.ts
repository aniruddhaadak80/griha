import { ENGINE_VERSION } from "@/lib/engine";
import { fail, ok } from "@/lib/errors";
import type { FairnessResponse } from "@/lib/api-types";
import { resolveHousehold } from "@/lib/server";
import { computeHouseholdFairness } from "@/lib/service";

export const runtime = "nodejs";

/**
 * Run the fairness engine.
 *
 * The same function backs `/board`, `/fairness`, the export centre and the MCP
 * `compute_fairness` tool. `?refresh=false` skips the two upstream feed calls
 * and returns the engine scored against a sealed context, which keeps repeated
 * polling of an agent loop cheap.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const refresh = url.searchParams.get("refresh") !== "false";

    const resolved = await resolveHousehold(request);
    if (!resolved) return fail(new Error("No household for this session."));

    const fairness = await computeHouseholdFairness(resolved.repo, resolved.bundle, new Date(), {
      fetchContext: refresh,
    });

    const payload: FairnessResponse = {
      fairness,
      household: resolved.household,
      choreCount: resolved.bundle.chores.length,
    };

    return ok(payload, { seal: fairness.seal, engineVersion: ENGINE_VERSION });
  } catch (error) {
    return fail(error);
  }
}