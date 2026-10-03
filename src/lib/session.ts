/**
 * Anonymous household sessions.
 *
 * Griha has no accounts. Ownership is an anonymous server-issued scope stored
 * in an HTTP-only cookie, which gives the properties that actually matter here:
 *
 *   - a browser cannot read or forge it from JavaScript (`HttpOnly`);
 *   - it is not sent on cross-site requests (`SameSite=Lax`), which blocks the
 *     cheap cross-site write attack that anonymous public write endpoints invite;
 *   - it is pinned to `Secure` in production;
 *   - and it is a 192-bit random identifier, so it cannot be guessed or walked.
 *
 * Read-only access to a shared rota uses a separate, deliberately
 * non-secret token in the URL path. That token grants strictly less than the
 * session cookie: it can read a chore board, and nothing else.
 */

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "griha_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function newSessionId(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * Read the current session id, minting and setting one when absent.
 *
 * Cookie mutation is only legal inside a Route Handler or a Server Action, so
 * this throws if a Server Component ever calls it. That is intentional: a
 * Server Component cannot persist a cookie, and silently returning a throwaway
 * id would create records that no later request could reach.
 *
 * `secure` must reflect the protocol the request actually arrived on, not
 * `NODE_ENV`. Keying it off NODE_ENV looks equivalent and is not: a production
 * build served over plain HTTP — a self-hosted deployment, a reverse proxy, or
 * simply `next start` on a laptop — would get a `Secure` cookie the client
 * refuses to store, and every data-backed page would redirect to bootstrap for
 * ever.
 */
export async function getSessionId(options: { secure?: boolean } = {}): Promise<string> {
  const store = await cookies();
  const existing = store.get(SESSION_COOKIE)?.value;
  if (existing && /^[A-Za-z0-9_-]{20,64}$/.test(existing)) return existing;

  const id = newSessionId();
  store.set(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: options.secure ?? process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return id;
}

/**
 * Whether the current request arrived over TLS.
 *
 * Read from the proxy headers first, because behind Vercel and any reverse
 * proxy the socket is plain HTTP even when the browser used HTTPS.
 */
export function requestIsSecure(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0]?.trim() === "https";
  if (request.headers.get("x-forwarded-ssl") === "on") return true;
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return process.env.NODE_ENV === "production";
  }
}

/** Read the session id without creating one. Safe from Server Components. */
export async function peekSessionId(): Promise<string | null> {
  const store = await cookies();
  const existing = store.get(SESSION_COOKIE)?.value;
  return existing && /^[A-Za-z0-9_-]{20,64}$/.test(existing) ? existing : null;
}

/**
 * Best-effort per-IP throttle for anonymous writes.
 *
 * Serverless invocations do not share a process, so an in-memory counter only
 * sees traffic that happens to land on the same warm instance. It is documented
 * as best-effort for exactly that reason; a deployment that needs a hard limit
 * should put a hosted rate limiter in front (the README documents this).
 */
const WINDOW_MS = 60_000;
const MAX_WRITES_PER_WINDOW = 40;
const writeLog = new Map<string, number[]>();

export interface RateLimitVerdict {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  scope: "best-effort-process";
}

export function checkWriteRate(identifier: string): RateLimitVerdict {
  const now = Date.now();
  const recent = (writeLog.get(identifier) ?? []).filter((t) => now - t < WINDOW_MS);

  if (recent.length >= MAX_WRITES_PER_WINDOW) {
    const oldest = recent[0] ?? now;
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((WINDOW_MS - (now - oldest)) / 1000)),
      scope: "best-effort-process",
    };
  }

  recent.push(now);
  writeLog.set(identifier, recent);

  // Opportunistic cleanup so the map cannot grow without bound on a long-lived
  // instance.
  if (writeLog.size > 5_000) {
    for (const [key, times] of writeLog) {
      if (times.every((t) => now - t >= WINDOW_MS)) writeLog.delete(key);
    }
  }

  return {
    allowed: true,
    remaining: MAX_WRITES_PER_WINDOW - recent.length,
    retryAfterSeconds: 0,
    scope: "best-effort-process",
  };
}

/** Coarse client identity for throttling. Deliberately not persisted. */
export function clientKey(request: Request): string {
  const headers = request.headers;
  const forwarded = headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
  return ip.slice(0, 64);
}