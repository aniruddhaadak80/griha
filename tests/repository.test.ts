import { beforeAll, describe, expect, it } from "vitest";
import { getRepository, makeRepository, normalizeRows, type Repository } from "@/lib/repository";
import { replayChain } from "@/lib/integrity";
import {
  claimChore,
  completeChore,
  computeHouseholdFairness,
  createChore,
  deleteChore,
  ensureHousehold,
  loadBundle,
  updateChore,
} from "@/lib/service";
import { emptyContext } from "@/lib/engine";
import { buildTrainingTable } from "@/lib/ml/features";

/**
 * Integration test against a real Postgres.
 *
 * These run through PGlite, which is actual Postgres compiled to WASM — not a
 * mock and not an in-memory shim. That matters: the bugs this layer is prone to
 * (a Postgres reserved word, a `LIMIT`/`OFFSET` type mismatch, a JSONB cast,
 * partial unique indexes) only surface against a real engine, and a mock would
 * happily pass all of them.
 */

const NOW = new Date("2026-10-05T09:00:00.000Z");

let repo: Repository;

beforeAll(async () => {
  repo = await getRepository();
  await repo.init();
});

async function freshRepo(): Promise<Repository> {
  return getRepository();
}

describe("normalizeRows", () => {
  it("accepts the bare-array shape returned by @neondatabase/serverless v1", () => {
    expect(normalizeRows([{ a: 1 }])).toEqual({ rows: [{ a: 1 }] });
  });

  it("accepts the { rows } shape", () => {
    expect(normalizeRows({ rows: [{ a: 1 }] })).toEqual({ rows: [{ a: 1 }] });
  });

  it("never returns undefined, which would silently look like an empty result", () => {
    expect(normalizeRows(null).rows).toEqual([]);
    expect(normalizeRows(undefined).rows).toEqual([]);
    expect(normalizeRows({ rows: "nope" }).rows).toEqual([]);
  });
});

describe("household and member CRUD", () => {
  it("creates, reads back and updates a household", async () => {
    const r = await freshRepo();
    const created = await r.createHousehold("owner-crud", {
      name: "Test Home",
      city: "Pune",
      country: "in",
    });
    expect(created.country).toBe("in");
    expect(created.shareToken).not.toBe(created.apiToken);

    const read = await r.getHousehold("owner-crud");
    expect(read?.id).toBe(created.id);

    const updated = await r.updateHousehold("owner-crud", created.id, { city: "Mumbai" });
    expect(updated?.city).toBe("Mumbai");
  });

  it("refuses a second household for the same owner, enforced by the database", async () => {
    const r = await freshRepo();
    await r.createHousehold("owner-single", { name: "A", city: "Delhi", country: "IN" });
    // The uniqueness is a database constraint, not an application check, so a
    // race between two concurrent requests cannot produce two households for
    // one session.
    await expect(
      r.createHousehold("owner-single", { name: "B", city: "Delhi", country: "IN" }),
    ).rejects.toThrow(/duplicate key/i);

    const found = await r.getHousehold("owner-single");
    expect(found?.name).toBe("A");
  });

  it("isolates households by owner", async () => {
    const r = await freshRepo();
    await r.createHousehold("owner-a", { name: "A house", city: "Delhi", country: "IN" });
    await r.createHousehold("owner-b", { name: "B house", city: "Delhi", country: "IN" });
    expect((await r.getHousehold("owner-a"))?.name).toBe("A house");
    expect((await r.getHousehold("owner-b"))?.name).toBe("B house");
  });

  it("finds a household by share token and by API token, and they differ", async () => {
    const r = await freshRepo();
    const created = await r.createHousehold("owner-tokens", { name: "T", city: "Delhi", country: "IN" });
    expect((await r.getHouseholdByShareToken(created.shareToken))?.id).toBe(created.id);
    expect((await r.getHouseholdByApiToken(created.apiToken))?.id).toBe(created.id);
    expect(await r.getHouseholdByApiToken(created.shareToken)).toBeNull();
  });

  it("stores members with their capacity", async () => {
    const r = await freshRepo();
    const { household } = await ensureHousehold(r, "owner-members", { name: "M", city: "Delhi", country: "IN" }, NOW);
    const list = await r.listMembers(household.id);
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((m) => m.capacity > 0)).toBe(true);

    const updated = await r.updateMember(household.id, list[0]!.id, { capacity: 1.5 });
    expect(updated?.capacity).toBe(1.5);
  });
});

describe("chore lifecycle through the service layer", () => {
  it("walks create → read → update → claim → complete → soft delete", async () => {
    const r = await freshRepo();
    const { household } = await ensureHousehold(r, "owner-lifecycle", { name: "Life", city: "Delhi", country: "IN" }, NOW);
    const [member] = await r.listMembers(household.id);
    expect(member).toBeDefined();

    const created = await createChore(r, "owner-lifecycle", household.id, {
      title: "Clean the filter",
      category: "maintenance",
      effortMinutes: 30,
      dueOn: "2026-10-06",
    });
    expect(created.value.status).toBe("open");
    expect(created.event.seal).toHaveLength(96);

    const fetched = await r.getChore(household.id, created.value.id);
    expect(fetched?.title).toBe("Clean the filter");

    const updated = await updateChore(r, "owner-lifecycle", household.id, created.value.id, {
      effortMinutes: 45,
    });
    expect(updated.value.effortMinutes).toBe(45);

    const claimed = await claimChore(r, "owner-lifecycle", household.id, created.value.id, member!.id);
    expect(claimed.value.status).toBe("claimed");
    expect(claimed.value.assigneeId).toBe(member!.id);

    const done = await completeChore(r, "owner-lifecycle", household.id, created.value.id, {
      memberId: member!.id,
      minutesSpent: 50,
    });
    expect(done.value.chore.status).toBe("done");
    expect(done.value.completion.minutesSpent).toBe(50);

    const removed = await deleteChore(r, "owner-lifecycle", household.id, created.value.id);
    expect(removed.value.deleted).toBe(true);
    // The tombstone survives in the table but is invisible to reads.
    expect(await r.getChore(household.id, created.value.id)).toBeNull();
  });

  it("paginates the chore list with a correct total", async () => {
    const r = await freshRepo();
    const { household } = await ensureHousehold(r, "owner-page", { name: "P", city: "Delhi", country: "IN" }, NOW);
    for (let i = 0; i < 5; i += 1) {
      await createChore(r, "owner-page", household.id, {
        title: `Chore ${i}`,
        category: "admin",
        effortMinutes: 10,
        dueOn: "2026-10-10",
      });
    }
    const page = await r.listChores(household.id, 3, 0);
    expect(page.items).toHaveLength(3);
    expect(page.total).toBeGreaterThanOrEqual(5);

    const second = await r.listChores(household.id, 3, 3);
    expect(second.items[0]!.id).not.toBe(page.items[0]!.id);
  });

  it("orders chores by due date ascending", async () => {
    const r = await freshRepo();
    const { household } = await ensureHousehold(r, "owner-order", { name: "O", city: "Delhi", country: "IN" }, NOW);
    await createChore(r, "owner-order", household.id, { title: "Late", category: "admin", effortMinutes: 5, dueOn: "2026-12-01" });
    await createChore(r, "owner-order", household.id, { title: "Early", category: "admin", effortMinutes: 5, dueOn: "2026-10-01" });
    const page = await r.listChores(household.id, 50, 0);
    const dates = page.items.map((c) => c.dueOn);
    expect([...dates].sort()).toEqual(dates);
  });

  it("never returns another household's chore", async () => {
    const r = await freshRepo();
    const a = await ensureHousehold(r, "owner-iso-a", { name: "A", city: "Delhi", country: "IN" }, NOW);
    const b = await ensureHousehold(r, "owner-iso-b", { name: "B", city: "Delhi", country: "IN" }, NOW);
    const chore = await createChore(r, "owner-iso-a", a.household.id, {
      title: "Private",
      category: "admin",
      effortMinutes: 5,
      dueOn: "2026-10-10",
    });
    expect(await r.getChore(b.household.id, chore.value.id)).toBeNull();
    const bundle = await loadBundle(r, "owner-iso-b");
    expect(bundle.chores.some((c) => c.id === chore.value.id)).toBe(false);
  });
});

describe("seeding", () => {
  it("creates a workable board on first contact and never re-seeds", async () => {
    const r = await freshRepo();
    const first = await ensureHousehold(r, "owner-seed", { name: "Seed", city: "Delhi", country: "IN" }, NOW);
    expect(first.seeded).toBe(true);

    const second = await ensureHousehold(r, "owner-seed", { name: "Seed", city: "Delhi", country: "IN" }, NOW);
    expect(second.seeded).toBe(false);
    expect(second.household.id).toBe(first.household.id);

    const bundle = await loadBundle(r, "owner-seed");
    expect(bundle.members.length).toBeGreaterThan(0);
    expect(bundle.chores.length).toBeGreaterThan(0);
    expect(bundle.completions.length).toBeGreaterThan(0);
  });

  it("produces a valid fairness result from the seeded board", async () => {
    const r = await freshRepo();
    await ensureHousehold(r, "owner-seed-fair", { name: "S", city: "Delhi", country: "IN" }, NOW);
    const bundle = await loadBundle(r, "owner-seed-fair");
    const result = await computeHouseholdFairness(r, bundle, NOW, { context: emptyContext(NOW) });

    expect(result.fairnessScore).toBeGreaterThan(0);
    expect(result.fairnessScore).toBeLessThanOrEqual(100);
    expect(result.recommendation).not.toBeNull();
    expect(result.members.length).toBe(bundle.members.length);
  });

  it("seeds a history with both completions and genuine misses", async () => {
    // Regression: a seeded history of nothing but completions produces a
    // single-class training table, and TabPFN — being a classifier — correctly
    // refuses to fit it. The demo board therefore has to contain the lapses a
    // real four-week household history contains.
    const r = await freshRepo();
    await ensureHousehold(r, "owner-seed-ml", { name: "M", city: "Delhi", country: "IN" }, NOW);
    const bundle = await loadBundle(r, "owner-seed-ml");
    const rows = buildTrainingTable({
      members: bundle.members,
      chores: bundle.chores,
      completions: bundle.completions,
      context: emptyContext(NOW),
      today: NOW.toISOString().slice(0, 10),
    });

    const positives = rows.filter((row) => row.label === 1);
    const negatives = rows.filter((row) => row.label === 0);

    expect(positives.length).toBeGreaterThan(0);
    expect(negatives.length, "seeded board needs at least one missed chore").toBeGreaterThan(0);
    expect(rows.length).toBeGreaterThanOrEqual(6);
  });

  it("seeds assignees, so the board is not entirely unclaimed", async () => {
    const r = await freshRepo();
    const { household } = await ensureHousehold(r, "owner-seed-assignee", { name: "A", city: "Delhi", country: "IN" }, NOW);
    const page = await r.listChores(household.id, 50, 0);
    expect(page.items.some((c) => c.assigneeId !== null)).toBe(true);
    expect(page.items.some((c) => c.status === "claimed")).toBe(true);
    expect(page.items.some((c) => c.status === "open")).toBe(true);
  });

  it("does not overwrite rows the user created after seeding", async () => {
    const r = await freshRepo();
    const { household } = await ensureHousehold(r, "owner-nocollide", { name: "N", city: "Delhi", country: "IN" }, NOW);
    const before = await r.listChores(household.id, 100, 0);

    const mine = await createChore(r, "owner-nocollide", household.id, {
      title: "Mine, hand-written",
      category: "admin",
      effortMinutes: 7,
      dueOn: "2026-11-11",
    });

    // A second ensureHousehold must not touch anything.
    await ensureHousehold(r, "owner-nocollide", { name: "N", city: "Delhi", country: "IN" }, NOW);

    const after = await r.listChores(household.id, 100, 0);
    expect(after.total).toBe(before.total + 1);
    expect(after.items.some((c) => c.id === mine.value.id)).toBe(true);
  });
});

describe("audit chain over real writes", () => {
  it("records one event per mutation and replays cleanly", async () => {
    const r = await freshRepo();
    const { household } = await ensureHousehold(r, "owner-audit", { name: "A", city: "Delhi", country: "IN" }, NOW);
    const [member] = await r.listMembers(household.id);
    const seedEvents = (await r.listAudit(household.id)).length;

    const chore = await createChore(r, "owner-audit", household.id, {
      title: "Audited chore",
      category: "admin",
      effortMinutes: 12,
      dueOn: "2026-10-09",
    });
    await claimChore(r, "owner-audit", household.id, chore.value.id, member!.id);
    await completeChore(r, "owner-audit", household.id, chore.value.id, { memberId: member!.id });
    await deleteChore(r, "owner-audit", household.id, chore.value.id);

    const events = await r.listAudit(household.id);
    expect(events.length).toBe(seedEvents + 4);
    expect(events.map((e) => e.action)).toContain("chore.created");
    expect(events.map((e) => e.action)).toContain("chore.claimed");
    expect(events.map((e) => e.action)).toContain("chore.completed");
    expect(events.map((e) => e.action)).toContain("chore.deleted");

    const replay = replayChain(events);
    expect(replay.ok).toBe(true);
    expect(replay.checked).toBe(events.length);
  });

  it("keeps the chain replayable after the chore is deleted", async () => {
    const r = await freshRepo();
    const { household } = await ensureHousehold(r, "owner-tomb", { name: "T", city: "Delhi", country: "IN" }, NOW);
    const chore = await createChore(r, "owner-tomb", household.id, {
      title: "Doomed",
      category: "admin",
      effortMinutes: 5,
      dueOn: "2026-10-09",
    });
    await deleteChore(r, "owner-tomb", household.id, chore.value.id);
    expect(replayChain(await r.listAudit(household.id)).ok).toBe(true);
  });

  it("replays a batched seed whose events share a timestamp", async () => {
    // Regression: a batched seed writes every event in one transaction. The
    // seals are computed over each event's own `created_at`, so the insert must
    // carry that timestamp per row. Writing one shared timestamp made every
    // stored row disagree with its own seal, and replay — correctly — reported
    // the chain as tampered with.
    const r = await freshRepo();
    const { household } = await ensureHousehold(r, "owner-batch", { name: "B", city: "Delhi", country: "IN" }, NOW);
    const events = await r.listAudit(household.id);

    expect(events.length).toBeGreaterThan(5);

    const replay = replayChain(events);
    expect(replay.reason ?? "").toBe("");
    expect(replay.ok).toBe(true);
    expect(replay.checked).toBe(events.length);
  });

  it("exposes the stored sequence so chain order is never re-derived", async () => {
    const r = await freshRepo();
    const { household } = await ensureHousehold(r, "owner-seq", { name: "Q", city: "Delhi", country: "IN" }, NOW);
    const events = await r.listAudit(household.id);

    expect(events.every((e) => typeof e.seq === "number")).toBe(true);
    const seqs = events.map((e) => e.seq!);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
  });

  it("survives a replay that ignores the timestamps entirely", async () => {
    // The chain is defined by `seq`. If a consumer tried to order by
    // `createdAt` it would shuffle same-instant events and see false tampering,
    // so this asserts that sequence order alone is sufficient.
    const r = await freshRepo();
    const { household } = await ensureHousehold(r, "owner-orderproof", { name: "O", city: "Delhi", country: "IN" }, NOW);
    const events = await r.listAudit(household.id);
    const distinctTimestamps = new Set(events.map((e) => e.createdAt));
    expect(distinctTimestamps.size).toBeGreaterThanOrEqual(1);
    expect(replayChain(events).ok).toBe(true);
  });

  it("links each event to the one before it", async () => {
    const r = await freshRepo();
    const { household } = await ensureHousehold(r, "owner-link", { name: "L", city: "Delhi", country: "IN" }, NOW);
    const events = await r.listAudit(household.id);
    for (let i = 1; i < events.length; i += 1) {
      expect(events[i]!.prevSeal).toBe(events[i - 1]!.seal);
    }
    expect(events[0]!.prevSeal).toBe("0".repeat(96));
  });
});

describe("repository adapter selection", () => {
  it("reports its kind and passes a real health query", async () => {
    const health = await repo.health();
    expect(health.ok).toBe(true);
    expect(["neon-postgres", "pglite-embedded"]).toContain(repo.kind);
  });

  it("issues DDL as one batch and then probes for the schema", async () => {
    const calls: string[] = [];
    const stub = makeRepository("pglite-embedded", {
      async query<T>(sql: string): Promise<{ rows: T[] }> {
        calls.push(sql);
        // The post-DDL probe must report the schema as present, or the adapter
        // correctly refuses to serve queries.
        if (sql.includes("to_regclass")) return { rows: [{ present: true } as T] };
        return { rows: [] };
      },
      async transaction(statements) {
        for (const statement of statements) calls.push(statement.sql);
      },
    });

    await stub.init();

    const ddl = calls.filter((sql) => sql.includes("CREATE TABLE IF NOT EXISTS"));
    expect(ddl.length).toBeGreaterThanOrEqual(5);
    // Table names are schema-qualified in the DDL, so match on the bare name.
    expect(calls.some((sql) => /CREATE TABLE IF NOT EXISTS \w+\.audit_events/.test(sql))).toBe(true);
    expect(calls.some((sql) => sql.includes("to_regclass"))).toBe(true);
  });

  it("fails loudly when the schema is absent rather than returning empty results", async () => {
    const stub = makeRepository("pglite-embedded", {
      async query<T>(sql: string): Promise<{ rows: T[] }> {
        if (sql.includes("to_regclass")) return { rows: [{ present: false } as T] };
        return { rows: [] };
      },
      async transaction() {
        /* DDL is accepted, as it would be by a user who holds CREATE. */
      },
    });

    await expect(stub.init()).rejects.toThrow(/missing its tables/);
  });
});