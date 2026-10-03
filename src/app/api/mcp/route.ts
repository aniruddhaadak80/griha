/**
 * MCP-style JSON-RPC 2.0 endpoint.
 *
 * Speaks the Model Context Protocol shape: `initialize`, `tools/list`,
 * `tools/call`, plus `ping` and `notifications/initialized`. Every tool returns
 * a JSON Schema for its arguments, and every tool is scoped to one household.
 *
 * Authorisation: tools require a board token, supplied either as the
 * `X-Griha-Token` header or as `boardToken` in the tool arguments. There is no
 * ambient-cookie fallback, because an MCP client is an external program — if it
 * could act on whichever browser happened to call it, any page on the internet
 * could drive a household's ledger. Read-only tools also accept the household's
 * share token, which grants strictly less.
 *
 * Mutating tools call `src/lib/service.ts`, the same functions the UI calls, so
 * an agent and a person produce identical rows and identical seals.
 */

import { ENGINE_VERSION } from "@/lib/engine";
import { fail } from "@/lib/errors";
import { getRepository, type Repository } from "@/lib/repository";
import { GENESIS_SEAL, replayChain } from "@/lib/integrity";
import { getHouseholdContext } from "@/lib/context";
import {
  claimChore,
  completeChore,
  computeHouseholdFairness,
  createChore,
  createMember,
  deleteChore,
  loadBundleByShareToken,
  updateChore,
} from "@/lib/service";
import { checkWriteRate } from "@/lib/session";
import {
  LIMITS,
  ValidationError,
  optionalBoolean,
  optionalBoundedString,
  optionalString,
  parseChoreCategory,
  requireId,
  requireInt,
  requireIsoDate,
  requireString,
} from "@/lib/validation";
import type { Household } from "@/lib/types";

export const runtime = "nodejs";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "griha", version: "1.0.0" };

/* -------------------------------------------------------------------------- */
/* JSON-RPC plumbing                                                           */
/* -------------------------------------------------------------------------- */

const RPC_PARSE_ERROR = -32700;
const RPC_INVALID_REQUEST = -32600;
const RPC_METHOD_NOT_FOUND = -32601;
const RPC_INVALID_PARAMS = -32602;
const RPC_INTERNAL_ERROR = -32603;

type RpcId = string | number | null;

interface RpcRequest {
  jsonrpc?: string;
  id?: RpcId;
  method?: string;
  params?: Record<string, unknown>;
}

function rpcResult(id: RpcId, result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id, result }, { status: 200 });
}

function rpcError(id: RpcId, code: number, message: string, data?: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } }, { status: 200 });
}

/**
 * JSON-RPC over HTTP answers 200 even for protocol-level errors; the error lives
 * in the body. Only a transport or auth failure uses a non-200 status, which is
 * what a well-behaved MCP client expects.
 */
function toolContent(value: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
    isError: false,
  };
}

function toolError(message: string) {
  return { content: [{ type: "text", text: message }], isError: true };
}

/* -------------------------------------------------------------------------- */
/* Tool definitions                                                            */
/* -------------------------------------------------------------------------- */

const BOARD_TOKEN_SCHEMA = {
  type: "string",
  description: "Household board token from Griha Settings. Accepts a read-only share token.",
};

const TOOLS = [
  {
    name: "get_household",
    title: "Get the household",
    description:
      "Read the household this board belongs to: name, city, country, member count and chore count. Start here to confirm the token is valid.",
    inputSchema: {
      type: "object",
      properties: { boardToken: BOARD_TOKEN_SCHEMA },
      required: ["boardToken"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "list_chores",
    title: "List chores",
    description:
      "List the household chore board with status, assignee, effort and due date. Optionally filter by status.",
    inputSchema: {
      type: "object",
      properties: {
        boardToken: BOARD_TOKEN_SCHEMA,
        status: { type: "string", enum: ["open", "claimed", "done", "skipped"] },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      },
      required: ["boardToken"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "compute_fairness",
    title: "Run the fairness engine",
    description:
      "Run the deterministic fairness engine and return the household score, per-member deviation from fair share, every factor with its weight and arithmetic, outdoor weather suitability, and the single recommended next action. Same engine as the web UI.",
    inputSchema: {
      type: "object",
      properties: {
        boardToken: BOARD_TOKEN_SCHEMA,
        refreshContext: {
          type: "boolean",
          default: true,
          description: "Fetch live weather and public holidays. False reuses a sealed offline context.",
        },
      },
      required: ["boardToken"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "get_city_context",
    title: "Get live weather and holidays",
    description:
      "Return the normalised seven-day forecast and public holidays the engine scores against, with the upstream source URL, fetch time and a live/fallback flag for each feed.",
    inputSchema: {
      type: "object",
      properties: { boardToken: BOARD_TOKEN_SCHEMA },
      required: ["boardToken"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "create_chore",
    title: "Add a chore",
    description:
      "Add a chore to the board. Pass the same idempotencyKey on a retry to avoid creating a duplicate. Returns the new chore and the audit seal.",
    inputSchema: {
      type: "object",
      properties: {
        boardToken: BOARD_TOKEN_SCHEMA,
        title: { type: "string", minLength: 2, maxLength: LIMITS.choreTitle },
        category: {
          type: "string",
          enum: ["kitchen", "cleaning", "laundry", "outdoor", "maintenance", "shopping", "pets", "admin"],
        },
        effortMinutes: { type: "integer", minimum: 1, maximum: LIMITS.effortMinutesMax },
        dueOn: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "ISO date, YYYY-MM-DD" },
        assigneeId: { type: "string", description: "Member id from get_household. Omit to leave it unclaimed." },
        outdoor: { type: "boolean", default: false, description: "Weather-sensitive work such as bins or laundry lines." },
        note: { type: "string", maxLength: LIMITS.choreNote },
        idempotencyKey: { type: "string", minLength: 8, maxLength: LIMITS.idempotencyKey },
      },
      required: ["boardToken", "title", "category", "effortMinutes", "dueOn"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "claim_chore",
    title: "Claim a chore",
    description:
      "Assign an open chore to a member. This is the same service call the Claim button makes, and appends the same sealed audit event.",
    inputSchema: {
      type: "object",
      properties: {
        boardToken: BOARD_TOKEN_SCHEMA,
        choreId: { type: "string" },
        memberId: { type: "string" },
      },
      required: ["boardToken", "choreId", "memberId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "complete_chore",
    title: "Complete a chore",
    description:
      "Record that a member finished a chore. Writes a completion row, flips the chore to done, and appends one sealed audit event. minutesSpent defaults to the chore's estimate.",
    inputSchema: {
      type: "object",
      properties: {
        boardToken: BOARD_TOKEN_SCHEMA,
        choreId: { type: "string" },
        memberId: { type: "string" },
        minutesSpent: { type: "integer", minimum: 1, maximum: LIMITS.effortMinutesMax },
        completedOn: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      },
      required: ["boardToken", "choreId", "memberId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: "add_member",
    title: "Add a household member",
    description:
      "Add a member with a relative capacity weight between 0.2 and 3.0. Capacity is what stops the fairness engine treating a night-shift worker and a stay-at-home parent as identical.",
    inputSchema: {
      type: "object",
      properties: {
        boardToken: BOARD_TOKEN_SCHEMA,
        name: { type: "string", minLength: 1, maxLength: LIMITS.memberName },
        capacity: { type: "number", minimum: LIMITS.capacityMin, maximum: LIMITS.capacityMax, default: 1 },
        tint: { type: "string", maxLength: 24 },
      },
      required: ["boardToken", "name"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: "update_chore",
    title: "Update a chore",
    description: "Change a chore's due date, effort, category, note, assignee or status.",
    inputSchema: {
      type: "object",
      properties: {
        boardToken: BOARD_TOKEN_SCHEMA,
        choreId: { type: "string" },
        dueOn: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        effortMinutes: { type: "integer", minimum: 1, maximum: LIMITS.effortMinutesMax },
        note: { type: "string", maxLength: LIMITS.choreNote },
        status: { type: "string", enum: ["open", "claimed", "done", "skipped"] },
        assigneeId: { type: "string" },
      },
      required: ["boardToken", "choreId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "delete_chore",
    title: "Delete a chore",
    description:
      "Soft-delete a chore. The row survives as a tombstone so the SHA-384 audit chain stays replayable; a subsequent read returns not-found, exactly as the UI behaves.",
    inputSchema: {
      type: "object",
      properties: {
        boardToken: BOARD_TOKEN_SCHEMA,
        choreId: { type: "string" },
      },
      required: ["boardToken", "choreId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
  {
    name: "verify_integrity",
    title: "Verify the audit chain",
    description:
      "Replay the SHA-384 hash chain for this household and report whether every link holds, the head seal, and the first broken event if any.",
    inputSchema: {
      type: "object",
      properties: { boardToken: BOARD_TOKEN_SCHEMA },
      required: ["boardToken"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
] as const;

/* -------------------------------------------------------------------------- */
/* Authorisation                                                               */
/* -------------------------------------------------------------------------- */

interface Authed {
  repo: Repository;
  household: Household;
  /** True when the caller presented the write-capable board token. */
  canWrite: boolean;
}

async function authorise(boardToken: string): Promise<Authed> {
  const token = requireString(boardToken, "boardToken", { min: 8, max: LIMITS.shareToken });
  const repo = await getRepository();

  const byApi = await repo.getHouseholdByApiToken(token);
  if (byApi) return { repo, household: byApi, canWrite: true };

  const byShare = await repo.getHouseholdByShareToken(token);
  if (byShare) return { repo, household: byShare, canWrite: false };

  throw new ValidationError("boardToken", "That board token does not match any household.");
}

function readToken(params: Record<string, unknown>, headerToken: string | null): string {
  const fromArgs = params.boardToken;
  const candidate =
    typeof fromArgs === "string" && fromArgs.length > 0 ? fromArgs : (headerToken ?? "");
  if (!candidate) {
    throw new ValidationError(
      "boardToken",
      "Pass boardToken in the tool arguments or an X-Griha-Token header. Find it on the Griha Settings page.",
    );
  }
  return candidate;
}

/* -------------------------------------------------------------------------- */
/* Tool dispatch                                                               */
/* -------------------------------------------------------------------------- */

async function dispatchTool(
  name: string,
  rawParams: Record<string, unknown>,
  headerToken: string | null,
): Promise<{ payload: unknown; httpMeta?: Record<string, unknown> }> {
  const params = rawParams ?? {};
  const token = readToken(params, headerToken);
  const auth = await authorise(token);

  const requireWrite = () => {
    if (!auth.canWrite) {
      throw new ValidationError(
        "boardToken",
        "That token is a read-only share token. Use the board token from Settings to change chores.",
      );
    }
  };

  const { repo, household } = auth;

  switch (name) {
    /* ------------------------------------------------------------- read */

    case "get_household": {
      const bundle = await loadBundleByShareToken(repo, household.shareToken);
      const active = bundle.chores.filter((c) => c.status !== "done" && c.status !== "skipped");
      return {
        payload: {
          household: {
            id: household.id,
            name: household.name,
            city: household.city,
            country: household.country,
            createdAt: household.createdAt,
          },
          members: bundle.members.map((m) => ({
            id: m.id,
            name: m.name,
            capacity: m.capacity,
            tint: m.tint,
          })),
          choreCount: bundle.chores.length,
          openChoreCount: active.length,
          canWrite: auth.canWrite,
        },
      };
    }

    case "list_chores": {
      const bundle = await loadBundleByShareToken(repo, household.shareToken);
      const status = params.status as string | undefined;
      const limit = requireInt(params.limit ?? 50, "limit", { min: 1, max: 200 });
      const chores = bundle.chores.filter((c) => !status || c.status === status).slice(0, limit);
      const names = new Map(bundle.members.map((m) => [m.id, m.name]));
      return {
        payload: {
          chores: chores.map((c) => ({
            ...c,
            assigneeName: c.assigneeId ? (names.get(c.assigneeId) ?? null) : null,
          })),
          total: bundle.chores.length,
        },
      };
    }

    case "compute_fairness": {
      const bundle = await loadBundleByShareToken(repo, household.shareToken);
      const refresh = params.refreshContext === undefined ? true : Boolean(params.refreshContext);
      const fairness = await computeHouseholdFairness(repo, bundle, new Date(), { fetchContext: refresh });
      return {
        payload: fairness,
        httpMeta: { seal: fairness.seal, engineVersion: fairness.version },
      };
    }

    case "get_city_context": {
      const context = await getHouseholdContext(household.city, household.country);
      return { payload: context };
    }

    case "verify_integrity": {
      const events = await repo.listAudit(household.id);
      // `listAudit` yields stored sequence order, which is the chain order.
      const replay = replayChain(events);
      return {
        payload: {
          householdId: household.id,
          ok: replay.ok,
          events: replay.checked,
          genesis: GENESIS_SEAL,
          headSeal: replay.headSeal,
          firstBrokenAt: replay.firstBrokenAt,
          firstBrokenId: replay.firstBrokenId,
          reason: replay.reason,
          algorithm: "seal_n = SHA-384(UTF-8(prevSeal) || canonicalJson(event_n))",
        },
        httpMeta: { seal: replay.headSeal },
      };
    }

    /* ------------------------------------------------------------ write */

    case "create_chore": {
      requireWrite();
      assertMcpRateLimit();
      const assigneeId = optionalString(params.assigneeId, "assigneeId", { max: 64 }) ?? null;
      const result = await createChore(repo, household.ownerId, household.id, {
        title: requireString(params.title, "title", { min: 2, max: LIMITS.choreTitle }),
        category: parseChoreCategory(params.category),
        effortMinutes: requireInt(params.effortMinutes, "effortMinutes", {
          min: 1,
          max: LIMITS.effortMinutesMax,
        }),
        dueOn: requireIsoDate(params.dueOn, "dueOn"),
        assigneeId,
        outdoor: optionalBoolean(params.outdoor, "outdoor") ?? false,
        note: optionalString(params.note, "note", { max: LIMITS.choreNote }) ?? "",
        idempotencyKey: optionalBoundedString(params.idempotencyKey, "idempotencyKey", {
          min: 8,
          max: LIMITS.idempotencyKey,
        }),
      });
      return { payload: { chore: result.value, seal: result.event.seal }, httpMeta: { seal: result.event.seal } };
    }

    case "claim_chore": {
      requireWrite();
      assertMcpRateLimit();
      const result = await claimChore(
        repo,
        household.ownerId,
        household.id,
        requireId(params.choreId, "choreId"),
        requireId(params.memberId, "memberId"),
      );
      return { payload: { chore: result.value, seal: result.event.seal }, httpMeta: { seal: result.event.seal } };
    }

    case "complete_chore": {
      requireWrite();
      assertMcpRateLimit();
      const minutesSpent =
        params.minutesSpent === undefined
          ? undefined
          : requireInt(params.minutesSpent, "minutesSpent", { min: 1, max: LIMITS.effortMinutesMax });
      const result = await completeChore(repo, household.ownerId, household.id, requireId(params.choreId, "choreId"), {
        memberId: requireId(params.memberId, "memberId"),
        ...(minutesSpent !== undefined ? { minutesSpent } : {}),
        ...(params.completedOn ? { completedOn: requireIsoDate(params.completedOn, "completedOn") } : {}),
      });
      return {
        payload: { chore: result.value.chore, completion: result.value.completion, seal: result.event.seal },
        httpMeta: { seal: result.event.seal },
      };
    }

    case "add_member": {
      requireWrite();
      assertMcpRateLimit();
      const capacity =
        params.capacity === undefined
          ? undefined
          : Number(params.capacity);
      if (capacity !== undefined && (!Number.isFinite(capacity) || capacity < LIMITS.capacityMin || capacity > LIMITS.capacityMax)) {
        throw new ValidationError("capacity", `capacity must be between ${LIMITS.capacityMin} and ${LIMITS.capacityMax}.`);
      }
      const result = await createMember(repo, household.ownerId, household.id, {
        name: requireString(params.name, "name", { min: 1, max: LIMITS.memberName }),
        ...(capacity !== undefined ? { capacity } : {}),
        ...(params.tint ? { tint: requireString(params.tint, "tint", { max: 24 }) } : {}),
      });
      return { payload: { member: result.value, seal: result.event.seal }, httpMeta: { seal: result.event.seal } };
    }

    case "update_chore": {
      requireWrite();
      assertMcpRateLimit();
      const result = await updateChore(
        repo,
        household.ownerId,
        household.id,
        requireId(params.choreId, "choreId"),
        {
          ...(params.dueOn ? { dueOn: requireIsoDate(params.dueOn, "dueOn") } : {}),
          ...(params.effortMinutes !== undefined
            ? { effortMinutes: requireInt(params.effortMinutes, "effortMinutes", { min: 1, max: LIMITS.effortMinutesMax }) }
            : {}),
          ...(params.note !== undefined ? { note: requireString(params.note, "note", { max: LIMITS.choreNote }) } : {}),
          ...(params.status !== undefined
            ? { status: requireString(params.status, "status") as "open" | "claimed" | "done" | "skipped" }
            : {}),
          ...(params.assigneeId !== undefined
            ? { assigneeId: optionalString(params.assigneeId, "assigneeId", { max: 64 }) ?? null }
            : {}),
        },
      );
      return { payload: { chore: result.value, seal: result.event.seal }, httpMeta: { seal: result.event.seal } };
    }

    case "delete_chore": {
      requireWrite();
      assertMcpRateLimit();
      const result = await deleteChore(
        repo,
        household.ownerId,
        household.id,
        requireId(params.choreId, "choreId"),
      );
      return {
        payload: { choreId: result.value.id, deleted: true, tombstone: true, seal: result.event.seal },
        httpMeta: { seal: result.event.seal },
      };
    }

    default:
      throw new ValidationError("name", `Unknown tool "${name}".`);
  }
}

/** Best-effort throttle, mirroring the REST surface. */
function assertMcpRateLimit(): void {
  const verdict = checkWriteRate("mcp");
  if (verdict.allowed) return;
  const error = new Error(
    `MCP writes are rate limited. Retry in ${verdict.retryAfterSeconds} seconds.`,
  ) as Error & { status: number; code: string; retryAfter: number };
  error.status = 429;
  error.code = "rate_limited";
  error.retryAfter = verdict.retryAfterSeconds;
  throw error;
}

/* -------------------------------------------------------------------------- */
/* Handler                                                                     */
/* -------------------------------------------------------------------------- */

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return rpcError(null, RPC_PARSE_ERROR, "Request body was not valid JSON.");
  }

  const headerToken = request.headers.get("x-griha-token");

  // Batch requests are part of the JSON-RPC spec; support them explicitly rather
  // than silently treating an array as a single malformed call.
  if (Array.isArray(body)) {
    if (body.length === 0) return rpcError(null, RPC_INVALID_REQUEST, "Batch was empty.");
    const responses = [];
    for (const entry of body) responses.push(await handleOne(entry as RpcRequest, headerToken));
    return Response.json(responses.filter(Boolean), { status: 200 });
  }

  const response = await handleOne(body as RpcRequest, headerToken);
  return response ?? new Response(null, { status: 202 });
}

async function handleOne(body: RpcRequest, headerToken: string | null): Promise<Response | null> {
  const id: RpcId = body && typeof body === "object" && "id" in body ? ((body.id ?? null) as RpcId) : null;
  const isNotification = !body || typeof body !== "object" || body.id === undefined;

  if (!body || typeof body !== "object" || typeof body.method !== "string") {
    return rpcError(id, RPC_INVALID_REQUEST, "Expected a JSON-RPC 2.0 object with a method.");
  }

  const params = (body.params ?? {}) as Record<string, unknown>;

  try {
    switch (body.method) {
      case "initialize":
        return rpcResult(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions:
            "Griha is a shared household chore ledger. Call get_household first to learn the member ids, then list_chores, " +
            "compute_fairness for the explainable load balance, and claim_chore or complete_chore to act. Mutations append to a " +
            "SHA-384 sealed audit chain; call verify_integrity to replay it.",
        });

      case "notifications/initialized":
        return null; // Notifications get no response body.

      case "ping":
        return rpcResult(id, {});

      case "tools/list":
        return rpcResult(id, { tools: TOOLS });

      case "tools/call": {
        const name = requireString(params.name, "name", { min: 1, max: 64 });
        if (!TOOLS.some((t) => t.name === name)) {
          return rpcError(id, RPC_INVALID_PARAMS, `Unknown tool "${name}".`);
        }
        const args = (params.arguments ?? {}) as Record<string, unknown>;
        const { payload, httpMeta } = await dispatchTool(name, args, headerToken);
        return rpcResult(id, { ...toolContent(payload), _meta: { griha: httpMeta ?? {} } });
      }

      default:
        if (isNotification) return null;
        return rpcError(id, RPC_METHOD_NOT_FOUND, `Method "${body.method}" is not supported.`);
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      return rpcResult(id, toolError(`${error.field}: ${error.message}`));
    }
    const status = (error as { status?: number }).status;
    if (status === 429) {
      const retryAfter = (error as { retryAfter?: number }).retryAfter ?? 60;
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: { code: RPC_INTERNAL_ERROR, message: "Rate limited.", data: { retryAfter } },
        }),
        { status: 429, headers: { "retry-after": String(retryAfter) } },
      );
    }
    if (status === 503) {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id, error: { code: RPC_INTERNAL_ERROR, message: "Store unavailable." } }),
        { status: 503 },
      );
    }
    return fail(error) as unknown as Response;
  }
}

/** GET exists so a browser or curl can confirm the endpoint is alive. */
export async function GET() {
  return Response.json({
    ok: true,
    data: {
      transport: "POST JSON-RPC 2.0",
      protocolVersion: PROTOCOL_VERSION,
      serverInfo: SERVER_INFO,
      methods: ["initialize", "notifications/initialized", "ping", "tools/list", "tools/call"],
      tools: TOOLS.map((t) => t.name),
      engine: ENGINE_VERSION,
    },
    meta: { engineVersion: ENGINE_VERSION },
  });
}