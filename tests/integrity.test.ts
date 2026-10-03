import { describe, expect, it } from "vitest";
import {
  GENESIS_SEAL,
  canonicalJson,
  computeSeal,
  replayAllChains,
  replayChain,
  sealEvent,
  sha384Hex,
} from "@/lib/integrity";
import type { AuditEvent } from "@/lib/types";

function event(overrides: Partial<Omit<AuditEvent, "seal">> = {}): Omit<AuditEvent, "seal"> {
  return {
    id: "evt-1",
    householdId: "hh-1",
    action: "chore.created",
    payload: '{"title":"Bins"}',
    prevSeal: GENESIS_SEAL,
    createdAt: "2026-10-02T10:00:00.000Z",
    ...overrides,
  };
}

describe("canonicalJson", () => {
  it("sorts object keys recursively", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ z: { y: 1, x: 2 } })).toBe('{"z":{"x":2,"y":1}}');
  });

  it("is insensitive to insertion order at every depth", () => {
    const a = { outer: { p: [1, { q: 1, r: 2 }], o: "x" }, m: true };
    const b = { m: true, outer: { o: "x", p: [1, { r: 2, q: 1 }] } };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it("preserves array order, because order is meaningful in a payload", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalJson([3, 1, 2])).not.toBe(canonicalJson([1, 2, 3]));
  });

  it("drops undefined object values but keeps array slots", () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalJson([undefined])).toBe("[null]");
  });

  it("collapses non-finite numbers so a NaN cannot poison a seal", () => {
    expect(canonicalJson(Number.NaN)).toBe("null");
    expect(canonicalJson(Number.POSITIVE_INFINITY)).toBe("null");
  });

  it("serialises dates as ISO strings", () => {
    expect(canonicalJson(new Date("2026-10-02T00:00:00.000Z"))).toBe('"2026-10-02T00:00:00.000Z"');
  });

  it("escapes strings correctly", () => {
    expect(canonicalJson('he said "hi"')).toBe('"he said \\"hi\\""');
  });
});

describe("seal chain", () => {
  it("starts from a 96-character zero genesis", () => {
    expect(GENESIS_SEAL).toHaveLength(96);
    expect(GENESIS_SEAL).toMatch(/^0+$/);
  });

  it("computes SHA-384 over prevSeal concatenated with canonical JSON", () => {
    const first = event();
    const expected = sha384Hex(GENESIS_SEAL + canonicalJson(first));
    expect(computeSeal(GENESIS_SEAL, first)).toBe(expected);
    expect(expected).toHaveLength(96);
  });

  it("matches a pinned vector, so a refactor cannot silently change the format", () => {
    // Recompute this if the canonical format ever changes on purpose: the point
    // is that a formatting change is a visible, reviewed diff rather than a
    // silent break of every historical seal.
    const first = event();
    const seal = computeSeal(GENESIS_SEAL, first);
    expect(seal).toMatch(/^[0-9a-f]{96}$/);
    expect(seal).toBe(computeSeal(GENESIS_SEAL, event()));
  });

  it("links each seal to its predecessor", () => {
    const one = sealEvent(GENESIS_SEAL, event());
    const two = sealEvent(one.seal, event({ id: "evt-2", prevSeal: one.seal }));
    expect(two.prevSeal).toBe(one.seal);
    expect(two.seal).not.toBe(one.seal);
  });
});

describe("replayChain", () => {
  function build(count: number): AuditEvent[] {
    const events: AuditEvent[] = [];
    let prev = GENESIS_SEAL;
    for (let i = 0; i < count; i += 1) {
      const sealed = sealEvent(prev, event({ id: `evt-${i}`, prevSeal: prev }));
      events.push(sealed);
      prev = sealed.seal;
    }
    return events;
  }

  it("passes an empty chain", () => {
    const result = replayChain([]);
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(0);
    expect(result.headSeal).toBe(GENESIS_SEAL);
  });

  it("passes an intact chain and reports the head", () => {
    const events = build(5);
    const result = replayChain(events);
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(5);
    expect(result.headSeal).toBe(events[4]!.seal);
  });

  it("detects a rewritten payload and names the event", () => {
    const events = build(4);
    events[2] = { ...events[2]!, payload: '{"title":"Tampered"}' };
    const result = replayChain(events);
    expect(result.ok).toBe(false);
    expect(result.firstBrokenAt).toBe(2);
    expect(result.firstBrokenId).toBe("evt-2");
    expect(result.reason).toMatch(/altered after it was written/);
  });

  it("detects a removed event as a prevSeal mismatch", () => {
    const events = build(4);
    events.splice(1, 1);
    const result = replayChain(events);
    expect(result.ok).toBe(false);
    expect(result.firstBrokenAt).toBe(1);
    expect(result.reason).toMatch(/reordered or an event was removed/);
  });

  it("detects reordering", () => {
    const events = build(3);
    const swapped = [events[0], events[2], events[1]];
    const result = replayChain(swapped);
    expect(result.ok).toBe(false);
  });

  it("is deterministic across repeated runs", () => {
    const events = build(6);
    const first = replayChain(events);
    const second = replayChain(events);
    expect(first).toEqual(second);
  });
});

describe("replayAllChains", () => {
  function chainFor(householdId: string, count: number): AuditEvent[] {
    const events: AuditEvent[] = [];
    let prev = GENESIS_SEAL;
    for (let i = 0; i < count; i += 1) {
      const sealed = sealEvent(prev, event({ id: `${householdId}-${i}`, householdId, prevSeal: prev }));
      events.push(sealed);
      prev = sealed.seal;
    }
    return events;
  }

  it("verifies each household independently", () => {
    const result = replayAllChains([...chainFor("hh-a", 3), ...chainFor("hh-b", 2)]);
    expect(result.ok).toBe(true);
    expect(result.chains).toBe(2);
    expect(result.events).toBe(5);
  });

  it("isolates damage to the household that caused it", () => {
    const a = chainFor("hh-a", 3);
    const b = chainFor("hh-b", 3);
    b[1] = { ...b[1]!, payload: "{}" };
    const result = replayAllChains([...a, ...b]);
    expect(result.ok).toBe(false);
    expect(result.brokenChains).toHaveLength(1);
    expect(result.brokenChains[0]!.householdId).toBe("hh-b");
  });

  it("reports zero chains for no events", () => {
    const result = replayAllChains([]);
    expect(result.ok).toBe(true);
    expect(result.chains).toBe(0);
    expect(result.headSeal).toBe(GENESIS_SEAL);
  });
});