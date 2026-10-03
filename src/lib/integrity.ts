/**
 * Append-only integrity chain, one independent chain per household.
 *
 * Each event is sealed with:
 *     seal_n = SHA-384( UTF-8(prevSeal) || canonicalJson(event_n) )
 *
 * `canonicalJson` recursively sorts object keys so the byte representation is
 * identical regardless of property insertion order. That stability is the whole
 * point: replaying the chain on another machine, a month later, in a different
 * process, must produce the same hex. Without canonical ordering, a JSON
 * key-order change would look like tampering.
 */

import { createHash } from "node:crypto";
import type { AuditEvent } from "./types";

/** 384 bits of zero hex — the seal before any event exists. */
export const GENESIS_SEAL = "0".repeat(96);

/**
 * Deterministic JSON serialisation.
 *
 * Rules, in order of importance:
 *   - object keys are sorted with a plain lexicographic sort;
 *   - `undefined` object values are omitted, `undefined` array entries become
 *     `null` (matching `JSON.stringify`);
 *   - non-finite numbers become `null`, because `JSON.stringify(NaN)` is already
 *     `null` and an engine result containing NaN would otherwise poison a seal;
 *   - arrays keep their order, because order is meaningful in an audit payload.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";

  const type = typeof value;
  if (type === "number") {
    const n = value as number;
    return Number.isFinite(n) ? JSON.stringify(n) : "null";
  }
  if (type === "boolean" || type === "string") return JSON.stringify(value);
  if (type === "undefined" || type === "function" || type === "symbol") return "null";

  if (value instanceof Date) return JSON.stringify(value.toISOString());

  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const entry = obj[key];
    if (entry === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${canonicalJson(entry)}`);
  }
  return `{${parts.join(",")}}`;
}

export function sha384Hex(input: string): string {
  return createHash("sha384").update(input, "utf8").digest("hex");
}

/** Recompute the seal of one event given the seal that preceded it. */
export function computeSeal(prevSeal: string, event: Omit<AuditEvent, "seal">): string {
  return sha384Hex(prevSeal + canonicalJson(event));
}

/** Build a sealed event that chains from `prevSeal`. */
export function sealEvent(prevSeal: string, event: Omit<AuditEvent, "seal">): AuditEvent {
  return { ...event, seal: computeSeal(prevSeal, event) };
}

export interface ReplayResult {
  ok: boolean;
  checked: number;
  firstBrokenAt: number | null;
  firstBrokenId: string | null;
  headSeal: string;
  reason: string | null;
}

export interface MultiReplayResult {
  ok: boolean;
  chains: number;
  events: number;
  brokenChains: Array<{
    householdId: string;
    firstBrokenAt: number | null;
    firstBrokenId: string | null;
    reason: string | null;
  }>;
  headSeal: string;
}

/**
 * Walk a single ordered chain and recompute every seal.
 *
 * `events` MUST already be in chain order — the order the rows were written.
 * Callers get that from `listAudit`, which sorts on the stored `seq`. Do not
 * re-derive the order from a timestamp: a batched write can stamp many events
 * with the same instant, and any secondary sort key (such as an id) will reorder
 * links that were sealed in a different order, which replay then reports as
 * tampering. Sequence is the chain; the clock is only metadata.
 *
 * Two distinct failures are reported separately, because they mean different
 * things to whoever is investigating:
 *   - `prevSeal mismatch` — an event was removed or the order changed;
 *   - `seal mismatch`     — an event's contents were altered after the fact.
 */
export function replayChain(events: AuditEvent[]): ReplayResult {
  if (events.length === 0) {
    return {
      ok: true,
      checked: 0,
      firstBrokenAt: null,
      firstBrokenId: null,
      headSeal: GENESIS_SEAL,
      reason: null,
    };
  }

  let prev = GENESIS_SEAL;
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
    if (!event) continue;

    if (event.prevSeal !== prev) {
      return {
        ok: false,
        checked: i,
        firstBrokenAt: i,
        firstBrokenId: event.id,
        headSeal: prev,
        reason: `prevSeal mismatch at index ${i}: the chain was reordered or an event was removed.`,
      };
    }

    const expected = computeSeal(prev, {
      id: event.id,
      householdId: event.householdId,
      action: event.action,
      payload: event.payload,
      prevSeal: event.prevSeal,
      createdAt: event.createdAt,
    });

    if (expected !== event.seal) {
      return {
        ok: false,
        checked: i,
        firstBrokenAt: i,
        firstBrokenId: event.id,
        headSeal: prev,
        reason: `seal mismatch at index ${i}: event ${event.id} was altered after it was written.`,
      };
    }

    prev = event.seal;
  }

  return { ok: true, checked: events.length, firstBrokenAt: null, firstBrokenId: null, headSeal: prev, reason: null };
}

/**
 * Replay every household chain independently.
 *
 * Chaining is per household rather than global so that one busy household
 * cannot invalidate another's history, and so a household can be exported and
 * verified on its own.
 */
export function replayAllChains(events: AuditEvent[]): MultiReplayResult {
  const groups = new Map<string, AuditEvent[]>();
  for (const event of events) {
    const list = groups.get(event.householdId);
    if (list) list.push(event);
    else groups.set(event.householdId, [event]);
  }

  const brokenChains: MultiReplayResult["brokenChains"] = [];
  let ok = true;
  let headSeal = GENESIS_SEAL;
  let total = 0;

  for (const [householdId, list] of groups) {
    // Already in stored sequence order; `replayAllChains` is deliberately not
    // re-sorting. See the note on `replayChain`.
    const ordered = list;

    const result = replayChain(ordered);
    total += ordered.length;

    if (!result.ok) {
      ok = false;
      brokenChains.push({
        householdId,
        firstBrokenAt: result.firstBrokenAt,
        firstBrokenId: result.firstBrokenId,
        reason: result.reason,
      });
    } else if (ordered.length > 0) {
      headSeal = ordered[ordered.length - 1]!.seal;
    }
  }

  return { ok, chains: groups.size, events: total, brokenChains, headSeal };
}