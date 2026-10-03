/**
 * Error taxonomy and the stable response envelope.
 *
 * Every API route answers with the same JSON shape, so a client never has to
 * guess whether `error` is a string or an object:
 *
 *   { "ok": true,  "data": ..., "meta": { seal, engineVersion } }
 *   { "ok": false, "error": { "code", "message", "field" }, "meta": { ... } }
 *
 * Status codes are chosen from the error class, not guessed per route: 400 for
 * malformed input, 404 for a record that is not this caller's, 405 for an
 * unsupported verb, 409 for a conflict, 429 for throttling, 503 when the store
 * is unreachable. Messages never include a stack trace, a SQL fragment or an
 * environment variable.
 */

import { ValidationError } from "./validation";

export class NotFoundError extends Error {
  readonly status = 404;
  readonly code = "not_found";
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends Error {
  readonly status = 409;
  readonly code = "conflict";
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

export class StoreUnavailableError extends Error {
  readonly status = 503;
  readonly code = "store_unavailable";
  constructor(message: string) {
    super(message);
    this.name = "StoreUnavailableError";
  }
}

export interface ApiMeta {
  seal?: string;
  engineVersion?: string;
  [key: string]: unknown;
}

export type ApiEnvelope =
  | { ok: true; data: unknown; meta: ApiMeta }
  | { ok: false; error: { code: string; message: string; field?: string }; meta: ApiMeta };

export function ok(data: unknown, meta: ApiMeta = {}): Response {
  return Response.json({ ok: true, data, meta } satisfies ApiEnvelope, { status: 200 });
}

export function created(data: unknown, meta: ApiMeta = {}): Response {
  return Response.json({ ok: true, data, meta } satisfies ApiEnvelope, { status: 201 });
}

export function fail(error: unknown, meta: ApiMeta = {}): Response {
  const mapped = mapError(error);
  return Response.json(
    { ok: false, error: { code: mapped.code, message: mapped.message, ...(mapped.field ? { field: mapped.field } : {}) }, meta } satisfies ApiEnvelope,
    { status: mapped.status, headers: mapped.retryAfter ? { "retry-after": String(mapped.retryAfter) } : undefined },
  );
}

interface MappedError {
  status: number;
  code: string;
  message: string;
  field?: string;
  retryAfter?: number;
}

/**
 * Translate any thrown value into a safe response.
 *
 * Unknown errors collapse to a generic 500 with no detail. That is intentional:
 * a Postgres error string can contain table and column names, and a driver
 * error can contain a connection string. The real message is logged server-side
 * by whoever calls this, never returned.
 */
export function mapError(error: unknown): MappedError {
  if (error instanceof ValidationError) {
    return { status: 400, code: "invalid_input", message: error.message, field: error.field };
  }
  if (error instanceof NotFoundError) {
    return { status: 404, code: "not_found", message: error.message };
  }
  if (error instanceof ConflictError) {
    return { status: 409, code: "conflict", message: error.message };
  }
  if (error instanceof StoreUnavailableError) {
    return { status: 503, code: "store_unavailable", message: error.message };
  }

  const tagged = error as { status?: unknown; code?: unknown; retryAfter?: unknown } | null;
  if (tagged && tagged.status === 429 && typeof tagged.code === "string") {
    return {
      status: 429,
      code: tagged.code,
      message: error instanceof Error ? error.message : "Too many requests.",
      retryAfter: typeof tagged.retryAfter === "number" ? tagged.retryAfter : 60,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  if (/database connection string|Refusing to start in production/i.test(message)) {
    return {
      status: 503,
      code: "store_unavailable",
      message: "The household store is not configured on this deployment.",
    };
  }

  return { status: 500, code: "internal_error", message: "Something went wrong handling that request." };
}

export function isRateLimited(error: unknown): error is Error & { retryAfter: number } {
  return error instanceof Error && typeof (error as { retryAfter?: unknown }).retryAfter === "number";
}