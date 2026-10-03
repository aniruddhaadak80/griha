import { getRepository } from "@/lib/repository";
import { getSessionId, requestIsSecure } from "@/lib/session";
import { ensureHousehold } from "@/lib/service";
import { DEFAULT_HOUSEHOLD } from "@/lib/server";

export const runtime = "nodejs";

/**
 * Session bootstrap.
 *
 * Server Components may read cookies but not set them, so the first visit to a
 * data-backed page cannot mint its own session during render. This handler owns
 * that job: it mints the cookie, seeds the household, and redirects back to
 * where the visitor was heading. That keeps the board server-rendered instead
 * of forcing every page through a client-side fetch.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);

  // Only same-site relative paths are honoured. Accepting an absolute URL here
  // would turn a redirect endpoint into an open redirect.
  const raw = url.searchParams.get("next") ?? "/board";
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/board";

  try {
    const repo = await getRepository();
    const ownerId = await getSessionId({ secure: requestIsSecure(request) });
    await ensureHousehold(repo, ownerId, DEFAULT_HOUSEHOLD, new Date());
  } catch (error) {
    // Log it: this handler still redirects, and without a log line a broken
    // store looks exactly like a working one until the next page throws.
    console.error("[griha] bootstrap could not prepare a household:", error);
    // Still redirect: the target page renders its own store-unavailable state,
    // which is more useful than a dead-end error screen here.
  }

  // A relative Location keeps the client on the host it asked for. An absolute
  // one is rebuilt from the server's view of the URL, which differs from the
  // host the browser used whenever the app is reached by an alias, a preview
  // domain or a LAN address.
  //
  // Built by hand rather than with NextResponse.redirect, which normalises the
  // Location through a path helper that rejects a URL instance in this runtime.
  return new Response(null, {
    status: 307,
    headers: { location: next, "cache-control": "no-store" },
  });
}