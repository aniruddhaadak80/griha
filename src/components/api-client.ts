"use client";

/**
 * Typed fetch wrapper for the Griha API.
 *
 * Every call goes through here so that:
 *   - the `{ ok, data, error }` envelope is unwrapped in exactly one place;
 *   - a failed request becomes a thrown `ApiError` carrying the server's code
 *     and field, which is what the UI renders;
 *   - the audit seal returned by a mutation is returned to the caller, so a
 *     component can show "recorded, seal 9f2c…" after a write.
 *
 * Nothing here retries automatically. A silent retry on a mutation would
 * duplicate work, and Griha mutations are already idempotent where it matters.
 */

export interface ApiMeta {
  seal?: string;
  engineVersion?: string;
  [key: string]: unknown;
}

export class ApiError extends Error {
  readonly code: string;
  readonly field: string | undefined;
  readonly status: number;
  constructor(message: string, code: string, field: string | undefined, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.field = field;
    this.status = status;
  }
}

export interface ApiResult<T> {
  data: T;
  meta: ApiMeta;
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; field?: string };
  meta?: ApiMeta;
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<ApiResult<T>> {
  const { json, ...rest } = init;

  let response: Response;
  try {
    response = await fetch(path, {
      ...rest,
      headers: {
        accept: "application/json",
        ...(json !== undefined ? { "content-type": "application/json" } : {}),
        ...(rest.headers ?? {}),
      },
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    });
  } catch {
    // A network failure is not an API error, and saying so matters: the UI shows
    // "could not reach Griha" rather than a server message that never arrived.
    throw new ApiError("Could not reach Griha. Check your connection and try again.", "network", undefined, 0);
  }

  let payload: Envelope<T> | null = null;
  try {
    payload = (await response.json()) as Envelope<T>;
  } catch {
    payload = null;
  }

  if (!payload) {
    throw new ApiError(
      `Griha returned an unreadable response (HTTP ${response.status}).`,
      "bad_response",
      undefined,
      response.status,
    );
  }

  if (!payload.ok) {
    throw new ApiError(
      payload.error?.message ?? "That request failed.",
      payload.error?.code ?? "unknown",
      payload.error?.field,
      response.status,
    );
  }

  return { data: payload.data as T, meta: payload.meta ?? {} };
}