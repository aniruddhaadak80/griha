import { ENGINE_VERSION } from "@/lib/engine";
import { fail, ok } from "@/lib/errors";
import { replayAllChains, replayChain, GENESIS_SEAL } from "@/lib/integrity";
import { resolveHousehold } from "@/lib/server";

export const runtime = "nodejs";

/**
 * Replay the audit chain.
 *
 * Two modes:
 *   `/api/verify`                — every household chain, useful for operators;
 *   `/api/verify?household=<id>` — just one, which is what the in-app panel uses.
 *
 * The response reports the *first* broken link rather than a boolean, because
 * "something is wrong" is not actionable and "event 7 of 42 was altered" is.
 */
export async function GET(request: Request) {
  try {
    const resolved = await resolveHousehold(request, { requireExisting: true });
    if (!resolved) return fail(new Error("No household for this session yet."));

    const events = await resolved.repo.listAudit(resolved.household.id);

    // `listAudit` returns stored sequence order, which is the chain order.
    // Replay must not re-derive it: a batched seed stamps every event in the
    // batch with the same instant, so a timestamp sort would shuffle links that
    // were sealed in a different order and report the chain as tampered with.
    const single = replayChain(events);
    const all = replayAllChains(events);

    return ok(
      {
        householdId: resolved.household.id,
        ok: single.ok,
        events: single.checked,
        genesis: GENESIS_SEAL,
        headSeal: single.headSeal,
        firstBrokenAt: single.firstBrokenAt,
        firstBrokenId: single.firstBrokenId,
        reason: single.reason,
        allChains: { ok: all.ok, chains: all.chains, events: all.events, brokenChains: all.brokenChains },
        trail: events.slice(-12).map((event) => ({
          seq: event.seq ?? null,
          id: event.id,
          action: event.action,
          seal: event.seal,
          prevSeal: event.prevSeal,
          createdAt: event.createdAt,
        })),
      },
      { seal: single.headSeal, engineVersion: ENGINE_VERSION },
    );
  } catch (error) {
    return fail(error);
  }
}