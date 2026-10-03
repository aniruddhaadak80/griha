/**
 * Repository access layer.
 *
 * Two adapters behind one interface:
 *   - Neon Postgres  (production; requires DATABASE_URL or POSTGRES_URL)
 *   - PGlite         (zero-config local dev and tests; embedded WASM Postgres)
 *
 * Both speak the same SQL, so the schema, indexes, constraints and queries are
 * written once. Production can never silently fall back to the embedded
 * database: `getRepository()` throws instead, because a cold start would erase
 * every household in the database.
 */

import { randomBytes, randomUUID } from "node:crypto";
import type {
  AuditAction,
  AuditEvent,
  Chore,
  ChoreCategory,
  ChoreStatus,
  Completion,
  CreateChoreInput,
  CreateMemberInput,
  Household,
  Member,
  UpdateChoreInput,
} from "./types";
import { GENESIS_SEAL, sealEvent } from "./integrity";

export interface SqlStatement {
  sql: string;
  params?: unknown[];
}

export type SqlExecutor = {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /**
   * Run several statements atomically.
   *
   * This exists because the two drivers disagree about what a transaction is.
   * PGlite is an in-process client, so `BEGIN`/`COMMIT` around the calls works.
   * The Neon serverless driver is HTTP: every `query()` is a separate request on
   * its own connection, so a hand-written `BEGIN` does not wrap the subsequent
   * statements and the unit of work silently falls apart. Each adapter
   * therefore implements atomicity the way its own driver means it.
   */
  transaction(statements: SqlStatement[]): Promise<void>;
};

/**
 * Resolve the production connection string.
 *
 * `DATABASE_URL` is the documented name. `POSTGRES_URL` is accepted because
 * that is what the Vercel Postgres and Neon marketplace integrations provision,
 * so a deploy does not need a manual copy-paste when a database is already
 * wired up.
 */
export function resolveDatabaseUrl(): string | undefined {
  return process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim() || undefined;
}

const SCHEMA_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Which Postgres schema to use. Deployments that share one instance with
 * another application can namespace their tables. The value is interpolated
 * into DDL, so it is validated against a strict identifier pattern first.
 */
export function resolveSchema(): string {
  const raw = process.env.DATABASE_SCHEMA?.trim();
  if (!raw) return "public";
  if (!SCHEMA_PATTERN.test(raw)) {
    throw new Error(
      `DATABASE_SCHEMA must match ${SCHEMA_PATTERN} (lowercase letters, digits and underscores, not starting with a digit).`,
    );
  }
  return raw;
}

/**
 * Normalise a driver result into `{ rows }`.
 *
 * `@neondatabase/serverless` v1 returns a bare array of rows while the
 * pg-compatible surface returns `{ rows }`. Reading `.rows` off an array yields
 * `undefined`, which silently turns every SELECT into an empty result set — a
 * failure that looks like "no data" rather than like an error. A unit test pins
 * this contract.
 */
export function normalizeRows<T>(result: unknown): { rows: T[] } {
  if (Array.isArray(result)) return { rows: result as T[] };
  const rows = (result as { rows?: T[] } | null | undefined)?.rows;
  return { rows: Array.isArray(rows) ? rows : [] };
}

/** 128 bits of URL-safe token for the public share route. */
function newShareToken(): string {
  return randomBytes(16).toString("base64url");
}

/** Everything needed to write a first-run household in one transaction. */
export interface SeedInput {
  householdId: string;
  ownerId: string;
  members: Array<{ id: string; name: string; capacity: number; tint: string }>;
  chores: Array<{
    id: string;
    title: string;
    category: ChoreCategory;
    effortMinutes: number;
    dueOn: string;
    outdoor: boolean;
    note: string;
  }>;
  completions: Array<{
    id: string;
    choreId: string;
    memberId: string;
    completedOn: string;
    minutesSpent: number;
  }>;
  /** Audit events in chain order; seals are computed here, not by the caller. */
  events: Array<{ id: string; action: AuditAction; payload: unknown }>;
}

export interface Repository {
  readonly kind: "neon-postgres" | "pglite-embedded";
  init(): Promise<void>;

  createHousehold(ownerId: string, input: { name: string; city: string; country: string }): Promise<Household>;
  getHousehold(ownerId: string): Promise<Household | null>;
  getHouseholdByShareToken(token: string): Promise<Household | null>;
  getHouseholdByApiToken(token: string): Promise<Household | null>;
  updateHousehold(
    ownerId: string,
    id: string,
    input: Partial<{ name: string; city: string; country: string }>,
  ): Promise<Household | null>;

  createMember(householdId: string, ownerId: string, input: CreateMemberInput): Promise<Member>;
  listMembers(householdId: string): Promise<Member[]>;
  updateMember(
    householdId: string,
    id: string,
    input: Partial<{ name: string; capacity: number; tint: string }>,
  ): Promise<Member | null>;

  createChore(householdId: string, ownerId: string, input: CreateChoreInput): Promise<Chore>;
  listChores(householdId: string, limit: number, offset: number): Promise<{ items: Chore[]; total: number }>;
  getChore(householdId: string, id: string): Promise<Chore | null>;
  updateChore(householdId: string, id: string, input: UpdateChoreInput): Promise<Chore | null>;
  deleteChore(householdId: string, id: string): Promise<Chore | null>;

  recordCompletion(
    householdId: string,
    input: { choreId: string; memberId: string; minutesSpent: number; completedOn: string },
  ): Promise<Completion>;
  listCompletions(householdId: string, sinceIso: string): Promise<Completion[]>;

  /**
   * Write a whole first-run household in one shot.
   *
   * Seeding row-by-row costs roughly one HTTP round trip per insert plus one
   * more per audit event. Against a serverless Postgres driver that is dozens of
   * sequential network calls, which turned the first page load into a
   * minute-and-a-half wait. This writes every table with a single `unnest`
   * insert inside one transaction, so the whole seed is four round trips and
   * either lands completely or not at all.
   */
  seedHousehold(input: SeedInput): Promise<void>;

  appendAudit(householdId: string, action: AuditAction, payload: unknown, ownerId: string): Promise<AuditEvent>;
  listAudit(householdId?: string): Promise<AuditEvent[]>;
  headSeal(householdId?: string): Promise<string>;

  health(): Promise<{ ok: boolean; detail: string }>;
}

/**
 * Schema DDL, one statement per entry.
 *
 * Both supported drivers use the PostgreSQL extended query protocol for
 * `query()`, which rejects more than one statement per call. A list is the only
 * shape that works unchanged on Neon and PGlite.
 *
 * `schema` is validated by `resolveSchema()` before it is interpolated here, so
 * it can only ever be a plain identifier. Index names are deliberately bare:
 * Postgres forbids schema-qualifying an index name.
 */
function schemaStatements(schema: string): string[] {
  return [
    `CREATE SCHEMA IF NOT EXISTS ${schema}`,
    `CREATE TABLE IF NOT EXISTS ${schema}.households (
      id          TEXT PRIMARY KEY,
      owner_id    TEXT NOT NULL,
      name        TEXT NOT NULL,
      city        TEXT NOT NULL DEFAULT '',
      country     TEXT NOT NULL DEFAULT 'IN',
      share_token TEXT NOT NULL,
      api_token   TEXT NOT NULL,
      deleted     BOOLEAN NOT NULL DEFAULT FALSE,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_households_owner
       ON ${schema}.households (owner_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_households_share
       ON ${schema}.households (share_token)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_households_api
       ON ${schema}.households (api_token)`,
    `CREATE TABLE IF NOT EXISTS ${schema}.members (
      id           TEXT PRIMARY KEY,
      household_id TEXT NOT NULL REFERENCES ${schema}.households(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      capacity     DOUBLE PRECISION NOT NULL DEFAULT 1,
      tint         TEXT NOT NULL DEFAULT 'terracotta',
      deleted      BOOLEAN NOT NULL DEFAULT FALSE,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_members_household
       ON ${schema}.members (household_id, created_at ASC)`,
    `CREATE TABLE IF NOT EXISTS ${schema}.chores (
      id              TEXT PRIMARY KEY,
      household_id    TEXT NOT NULL REFERENCES ${schema}.households(id) ON DELETE CASCADE,
      title           TEXT NOT NULL,
      category        TEXT NOT NULL,
      effort_minutes  INTEGER NOT NULL,
      due_on          TEXT NOT NULL,
      assignee_id     TEXT REFERENCES ${schema}.members(id) ON DELETE SET NULL,
      status          TEXT NOT NULL DEFAULT 'open',
      outdoor         BOOLEAN NOT NULL DEFAULT FALSE,
      note            TEXT NOT NULL DEFAULT '',
      deleted         BOOLEAN NOT NULL DEFAULT FALSE,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_chores_household
       ON ${schema}.chores (household_id, due_on ASC, created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS ${schema}.completions (
      id            TEXT PRIMARY KEY,
      household_id  TEXT NOT NULL REFERENCES ${schema}.households(id) ON DELETE CASCADE,
      chore_id      TEXT NOT NULL REFERENCES ${schema}.chores(id) ON DELETE CASCADE,
      member_id     TEXT NOT NULL REFERENCES ${schema}.members(id) ON DELETE CASCADE,
      completed_on  TEXT NOT NULL,
      minutes_spent INTEGER NOT NULL,
      created_at    TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_completions_window
       ON ${schema}.completions (household_id, completed_on DESC)`,
    `CREATE TABLE IF NOT EXISTS ${schema}.audit_events (
      seq          BIGSERIAL PRIMARY KEY,
      id           TEXT NOT NULL UNIQUE,
      household_id TEXT NOT NULL,
      owner_id     TEXT NOT NULL,
      action       TEXT NOT NULL,
      payload      TEXT NOT NULL,
      prev_seal    TEXT NOT NULL,
      seal         TEXT NOT NULL,
      created_at   TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_audit_household
       ON ${schema}.audit_events (household_id, seq ASC)`,
  ];
}

/* -------------------------------------------------------------------------- */
/* Row mapping                                                                 */
/* -------------------------------------------------------------------------- */

function rowToHousehold(row: Record<string, unknown>): Household {
  return {
    id: String(row.id),
    name: String(row.name),
    city: String(row.city ?? ""),
    country: String(row.country ?? "IN"),
    ownerId: String(row.owner_id),
    shareToken: String(row.share_token),
    apiToken: String(row.api_token ?? ""),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    deleted: Boolean(row.deleted),
  };
}

function rowToMember(row: Record<string, unknown>): Member {
  return {
    id: String(row.id),
    householdId: String(row.household_id),
    name: String(row.name),
    capacity: Number(row.capacity ?? 1),
    tint: String(row.tint ?? "terracotta"),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    deleted: Boolean(row.deleted),
  };
}

function rowToChore(row: Record<string, unknown>): Chore {
  return {
    id: String(row.id),
    householdId: String(row.household_id),
    title: String(row.title),
    category: row.category as ChoreCategory,
    effortMinutes: Number(row.effort_minutes ?? 0),
    dueOn: String(row.due_on),
    assigneeId: row.assignee_id ? String(row.assignee_id) : null,
    status: row.status as ChoreStatus,
    outdoor: Boolean(row.outdoor),
    note: String(row.note ?? ""),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    deleted: Boolean(row.deleted),
  };
}

function rowToCompletion(row: Record<string, unknown>): Completion {
  return {
    id: String(row.id),
    householdId: String(row.household_id),
    choreId: String(row.chore_id),
    memberId: String(row.member_id),
    completedOn: String(row.completed_on),
    minutesSpent: Number(row.minutes_spent ?? 0),
    createdAt: String(row.created_at),
  };
}

/* -------------------------------------------------------------------------- */
/* Shared SQL implementation                                                   */
/* -------------------------------------------------------------------------- */

function makeRepository(kind: Repository["kind"], db: SqlExecutor): Repository {
  const exec = (sql: string, params?: unknown[]) => db.query(sql, params);
  const execTx = (statements: SqlStatement[]) => db.transaction(statements);
  const schema = resolveSchema();
  let ready: Promise<void> | null = null;

  /** Run DDL once per module instance. Every public method goes through this. */
  function ensure(): Promise<void> {
    if (!ready) {
      ready = (async () => {
        // Issued as one batch rather than nineteen sequential round trips. On a
        // serverless Postgres driver every statement is a separate HTTP request,
        // and these are all idempotent `IF NOT EXISTS` guards, so sending them
        // together is both faster and exactly as safe.
        await execTx(schemaStatements(schema).map((sql) => ({ sql })));

        // One probe to confirm the schema really is there. If a deployment was
        // provisioned without permission to create it, fail loudly here rather
        // than letting every query return "no such table".
        const probe = await exec(
          `SELECT to_regclass('${schema}.audit_events') IS NOT NULL AS present`,
        );
        const row = probe.rows[0] as { present?: boolean } | undefined;
        if (!row?.present) {
          throw new Error(
            `Schema "${schema}" is missing its tables. The Griha database user needs CREATE on the schema.`,
          );
        }
      })();
    }
    return ready;
  }

  const repo: Repository = {
    kind,

    async init() {
      await ensure();
    },

    /* ---------------------------------------------------------------- household */

    async createHousehold(ownerId, input) {
      await ensure();
      const id = randomUUID();
      const now = new Date().toISOString();
      const shareToken = newShareToken();
      const apiToken = newShareToken();
      await exec(
        `INSERT INTO ${schema}.households (id, owner_id, name, city, country, share_token, api_token, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
        [id, ownerId, input.name, input.city, input.country, shareToken, apiToken, now],
      );
      return {
        id,
        name: input.name,
        city: input.city,
        country: input.country,
        ownerId,
        shareToken,
        apiToken,
        createdAt: now,
        updatedAt: now,
        deleted: false,
      };
    },

    async getHousehold(ownerId) {
      await ensure();
      const res = await exec(`SELECT * FROM ${schema}.households WHERE owner_id = $1 AND deleted = FALSE LIMIT 1`, [
        ownerId,
      ]);
      return res.rows[0] ? rowToHousehold(res.rows[0]) : null;
    },

    async getHouseholdByShareToken(token) {
      await ensure();
      const res = await exec(`SELECT * FROM ${schema}.households WHERE share_token = $1 AND deleted = FALSE LIMIT 1`, [
        token,
      ]);
      return res.rows[0] ? rowToHousehold(res.rows[0]) : null;
    },

    async getHouseholdByApiToken(token) {
      await ensure();
      const res = await exec(`SELECT * FROM ${schema}.households WHERE api_token = $1 AND deleted = FALSE LIMIT 1`, [
        token,
      ]);
      return res.rows[0] ? rowToHousehold(res.rows[0]) : null;
    },

    async updateHousehold(ownerId, id, input) {
      await ensure();
      const res = await exec(`SELECT * FROM ${schema}.households WHERE id = $1 AND owner_id = $2`, [id, ownerId]);
      const current = res.rows[0];
      if (!current) return null;

      const household = rowToHousehold(current);
      const now = new Date().toISOString();
      const next = {
        name: input.name?.trim() || household.name,
        city: input.city?.trim() || household.city,
        country: input.country?.trim().toUpperCase() || household.country,
      };

      await exec(
        `UPDATE ${schema}.households SET name = $1, city = $2, country = $3, updated_at = $4
         WHERE id = $5 AND owner_id = $6`,
        [next.name, next.city, next.country, now, id, ownerId],
      );
      return { ...household, ...next, updatedAt: now };
    },

    /* ------------------------------------------------------------------ members */

    async createMember(householdId, _ownerId, input) {
      await ensure();
      const id = randomUUID();
      const now = new Date().toISOString();
      await exec(
        `INSERT INTO ${schema}.members (id, household_id, name, capacity, tint, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)`,
        [id, householdId, input.name, input.capacity ?? 1, input.tint ?? "terracotta", now],
      );
      return {
        id,
        householdId,
        name: input.name,
        capacity: input.capacity ?? 1,
        tint: input.tint ?? "terracotta",
        createdAt: now,
        updatedAt: now,
        deleted: false,
      };
    },

    async listMembers(householdId) {
      await ensure();
      const res = await exec(
        `SELECT * FROM ${schema}.members WHERE household_id = $1 AND deleted = FALSE ORDER BY created_at ASC`,
        [householdId],
      );
      return res.rows.map(rowToMember);
    },

    async updateMember(householdId, id, input) {
      await ensure();
      const res = await exec(`SELECT * FROM ${schema}.members WHERE id = $1 AND household_id = $2`, [id, householdId]);
      const current = res.rows[0];
      if (!current) return null;

      const member = rowToMember(current);
      const now = new Date().toISOString();
      const next = {
        name: input.name?.trim() || member.name,
        capacity: Number.isFinite(input.capacity) && (input.capacity as number) > 0 ? (input.capacity as number) : member.capacity,
        tint: input.tint?.trim() || member.tint,
      };

      await exec(
        `UPDATE ${schema}.members SET name = $1, capacity = $2, tint = $3, updated_at = $4
         WHERE id = $5 AND household_id = $6`,
        [next.name, next.capacity, next.tint, now, id, householdId],
      );
      return { ...member, ...next, updatedAt: now };
    },

    /* ------------------------------------------------------------------- chores */

    async createChore(householdId, _ownerId, input) {
      await ensure();
      const id = randomUUID();
      const now = new Date().toISOString();
      const status: ChoreStatus = input.assigneeId ? "claimed" : "open";
      await exec(
        `INSERT INTO ${schema}.chores
           (id, household_id, title, category, effort_minutes, due_on, assignee_id, status, outdoor, note, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
        [
          id,
          householdId,
          input.title,
          input.category,
          input.effortMinutes,
          input.dueOn,
          input.assigneeId ?? null,
          status,
          input.outdoor ?? false,
          input.note ?? "",
          now,
        ],
      );
      return {
        id,
        householdId,
        title: input.title,
        category: input.category,
        effortMinutes: input.effortMinutes,
        dueOn: input.dueOn,
        assigneeId: input.assigneeId ?? null,
        status,
        outdoor: input.outdoor ?? false,
        note: input.note ?? "",
        createdAt: now,
        updatedAt: now,
        deleted: false,
      };
    },

    async listChores(householdId, limit, offset) {
      await ensure();
      const res = await exec(
        `SELECT * FROM ${schema}.chores WHERE household_id = $1 AND deleted = FALSE
         ORDER BY due_on ASC, created_at DESC LIMIT $2 OFFSET $3`,
        [householdId, limit, offset],
      );
      const count = await exec(
        `SELECT COUNT(*)::int AS total FROM ${schema}.chores WHERE household_id = $1 AND deleted = FALSE`,
        [householdId],
      );
      const totalRow = count.rows[0] as { total?: number } | undefined;
      return { items: res.rows.map(rowToChore), total: totalRow?.total ?? 0 };
    },

    async getChore(householdId, id) {
      await ensure();
      // Soft-deleted chores are invisible to normal reads; the tombstone row
      // remains so the audit chain stays replayable.
      const res = await exec(
        `SELECT * FROM ${schema}.chores WHERE id = $1 AND household_id = $2 AND deleted = FALSE`,
        [id, householdId],
      );
      return res.rows[0] ? rowToChore(res.rows[0]) : null;
    },

    async updateChore(householdId, id, input) {
      await ensure();
      const current = await repo.getChore(householdId, id);
      if (!current) return null;

      const now = new Date().toISOString();
      const assigneeId =
        input.assigneeId === undefined ? current.assigneeId : input.assigneeId === null ? null : input.assigneeId;
      const status = input.status ?? (assigneeId ? (current.status === "open" ? "claimed" : current.status) : current.status === "claimed" ? "open" : current.status);

      await exec(
        `UPDATE ${schema}.chores
            SET title = $1, category = $2, effort_minutes = $3, due_on = $4, assignee_id = $5,
                status = $6, outdoor = $7, note = $8, updated_at = $9
          WHERE id = $10 AND household_id = $11`,
        [
          input.title?.trim() || current.title,
          input.category ?? current.category,
          input.effortMinutes ?? current.effortMinutes,
          input.dueOn ?? current.dueOn,
          assigneeId,
          status,
          input.outdoor ?? current.outdoor,
          input.note ?? current.note,
          now,
          id,
          householdId,
        ],
      );

      return {
        ...current,
        title: input.title?.trim() || current.title,
        category: input.category ?? current.category,
        effortMinutes: input.effortMinutes ?? current.effortMinutes,
        dueOn: input.dueOn ?? current.dueOn,
        assigneeId,
        status,
        outdoor: input.outdoor ?? current.outdoor,
        note: input.note ?? current.note,
        updatedAt: now,
      };
    },

    async deleteChore(householdId, id) {
      await ensure();
      const current = await repo.getChore(householdId, id);
      if (!current) return null;
      const now = new Date().toISOString();
      await exec(`UPDATE ${schema}.chores SET deleted = TRUE, updated_at = $1 WHERE id = $2 AND household_id = $3`, [
        now,
        id,
        householdId,
      ]);
      return { ...current, deleted: true, updatedAt: now };
    },

    /* -------------------------------------------------------------- completions */

    async recordCompletion(householdId, input) {
      await ensure();
      const id = randomUUID();
      const now = new Date().toISOString();
      await exec(
        `INSERT INTO ${schema}.completions (id, household_id, chore_id, member_id, completed_on, minutes_spent, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, householdId, input.choreId, input.memberId, input.completedOn, input.minutesSpent, now],
      );
      return {
        id,
        householdId,
        choreId: input.choreId,
        memberId: input.memberId,
        completedOn: input.completedOn,
        minutesSpent: input.minutesSpent,
        createdAt: now,
      };
    },

    async listCompletions(householdId, sinceIso) {
      await ensure();
      const res = await exec(
        `SELECT * FROM ${schema}.completions WHERE household_id = $1 AND completed_on >= $2 ORDER BY completed_on ASC, id ASC`,
        [householdId, sinceIso],
      );
      return res.rows.map(rowToCompletion);
    },

    /* ------------------------------------------------------------------- audit */

    async seedHousehold(input) {
      await ensure();

      const { householdId, ownerId } = input;
      const now = new Date().toISOString();

      // Seeded events are stamped one millisecond apart rather than all at
      // `now`. The chain is defined by `seq`, not by the clock, but keeping the
      // timestamps strictly increasing means any human or tool that reads the
      // trail as a timeline still sees it in the right order.
      const base = Date.now();
      const events: AuditEvent[] = [];
      let prev = GENESIS_SEAL;
      for (const [index, event] of input.events.entries()) {
        const sealed = sealEvent(prev, {
          id: event.id,
          householdId,
          action: event.action,
          payload: JSON.stringify(event.payload ?? null),
          prevSeal: prev,
          createdAt: new Date(base + index).toISOString(),
        });
        events.push(sealed);
        prev = sealed.seal;
      }

      // One atomic batch: four bulk inserts, all or nothing. The adapter decides
      // how to make that atomic for its driver.
      const statements: SqlStatement[] = [];

      if (input.members.length > 0) {
        statements.push({
          sql: `INSERT INTO ${schema}.members (id, household_id, name, capacity, tint, deleted, created_at, updated_at)
             SELECT m.id, $1, m.name, m.capacity, m.tint, FALSE, $2, $2
               FROM unnest($3::text[], $4::text[], $5::double precision[], $6::text[])
                 AS m(id, name, capacity, tint)`,
          params: [
            householdId,
            now,
            input.members.map((m) => m.id),
            input.members.map((m) => m.name),
            input.members.map((m) => m.capacity),
            input.members.map((m) => m.tint),
          ],
        });
      }

      if (input.chores.length > 0) {
        statements.push({
          sql: `INSERT INTO ${schema}.chores
               (id, household_id, title, category, effort_minutes, due_on, assignee_id, status, outdoor, note, deleted, created_at, updated_at)
             SELECT c.id, $1, c.title, c.category, c.effort_minutes, c.due_on, NULL, 'open', c.outdoor, c.note, FALSE, $2, $2
               FROM unnest($3::text[], $4::text[], $5::text[], $6::integer[], $7::text[], $8::boolean[], $9::text[])
                 AS c(id, title, category, effort_minutes, due_on, outdoor, note)`,
          params: [
            householdId,
            now,
            input.chores.map((c) => c.id),
            input.chores.map((c) => c.title),
            input.chores.map((c) => c.category),
            input.chores.map((c) => c.effortMinutes),
            input.chores.map((c) => c.dueOn),
            input.chores.map((c) => c.outdoor),
            input.chores.map((c) => c.note),
          ],
        });
      }

      if (input.completions.length > 0) {
        statements.push({
          sql: `INSERT INTO ${schema}.completions
               (id, household_id, chore_id, member_id, completed_on, minutes_spent, created_at)
             SELECT x.id, $1, x.chore_id, x.member_id, x.completed_on, x.minutes_spent, $2
               FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::integer[])
                 AS x(id, chore_id, member_id, completed_on, minutes_spent)`,
          params: [
            householdId,
            now,
            input.completions.map((x) => x.id),
            input.completions.map((x) => x.choreId),
            input.completions.map((x) => x.memberId),
            input.completions.map((x) => x.completedOn),
            input.completions.map((x) => x.minutesSpent),
          ],
        });
      }

if (events.length > 0) {
          statements.push({
            // `created_at` is carried per event, not as one shared value. The
            // seal is computed over the event's own timestamp, so writing a
            // single timestamp for the batch would make every stored row
            // disagree with its own seal — which replay would then, correctly,
            // report as tampering.
            sql: `INSERT INTO ${schema}.audit_events
               (id, household_id, owner_id, action, payload, prev_seal, seal, created_at)
             SELECT e.id, $1, $2, e.action, e.payload, e.prev_seal, e.seal, e.created_at
               FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[])
                 AS e(id, action, payload, prev_seal, seal, created_at)`,
            params: [
              householdId,
              ownerId,
              events.map((e) => e.id),
              events.map((e) => e.action),
              events.map((e) => e.payload),
              events.map((e) => e.prevSeal),
              events.map((e) => e.seal),
              events.map((e) => e.createdAt),
            ],
          });
        }

      // Leave no half-seeded household behind: the audit chain would not match
      // the chores, which is exactly the failure this chain exists to detect.
      await execTx(statements);
    },

    async appendAudit(householdId, action, payload, ownerId) {
      await ensure();
      // Per-household chain: each household's history is independent, so one busy
      // household can never invalidate another's trail.
      const prevSeal = await repo.headSeal(householdId);
      const event = sealEvent(prevSeal, {
        id: randomUUID(),
        householdId,
        action,
        payload: JSON.stringify(payload ?? null),
        prevSeal,
        createdAt: new Date().toISOString(),
      });
      await exec(
        `INSERT INTO ${schema}.audit_events (id, household_id, owner_id, action, payload, prev_seal, seal, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [event.id, householdId, ownerId, action, event.payload, event.prevSeal, event.seal, event.createdAt],
      );
      return event;
    },

    async listAudit(householdId) {
      await ensure();
      const res = householdId
        ? await exec(`SELECT * FROM ${schema}.audit_events WHERE household_id = $1 ORDER BY seq ASC`, [householdId])
        : await exec(`SELECT * FROM ${schema}.audit_events ORDER BY seq ASC`);
      return res.rows.map(
        (row): AuditEvent => ({
          id: String(row.id),
          householdId: String(row.household_id),
          action: row.action as AuditAction,
          payload: String(row.payload),
          seal: String(row.seal),
          prevSeal: String(row.prev_seal),
          createdAt: String(row.created_at),
          seq: row.seq === null || row.seq === undefined ? undefined : Number(row.seq),
        }),
      );
    },

    async headSeal(householdId) {
      await ensure();
      const res = householdId
        ? await exec(`SELECT seal FROM ${schema}.audit_events WHERE household_id = $1 ORDER BY seq DESC LIMIT 1`, [
            householdId,
          ])
        : await exec(`SELECT seal FROM ${schema}.audit_events ORDER BY seq DESC LIMIT 1`);
      const row = res.rows[0] as { seal?: string } | undefined;
      return row?.seal ?? GENESIS_SEAL;
    },

    async health() {
      try {
        const res = await exec(`SELECT 1 AS ok`);
        const row = res.rows[0] as { ok?: number } | undefined;
        if (row?.ok === 1) return { ok: true, detail: "SELECT 1 succeeded" };
        return { ok: false, detail: "health query returned no rows" };
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : "unknown database error" };
      }
    },
  };

  return repo;
}

/* -------------------------------------------------------------------------- */
/* Neon adapter (production)                                                  */
/* -------------------------------------------------------------------------- */

let neonRepo: Repository | null = null;

async function getNeonRepository(): Promise<Repository> {
  if (neonRepo) return neonRepo;
  const url = resolveDatabaseUrl();
  if (!url) {
    throw new Error(
      "No production database configured. Set DATABASE_URL (or POSTGRES_URL, which the Vercel/Neon integrations provide).",
    );
  }
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url);
  const executor: SqlExecutor = {
    async query<T>(statement: string, params: unknown[] = []) {
      const result = (await sql.query(statement, params as never[])) as unknown;
      return normalizeRows<T>(result);
    },
    async transaction(statements: SqlStatement[]) {
      if (statements.length === 0) return;
      // The Neon HTTP driver sends a batch as one request and the server executes
      // it inside an implicit transaction, which is what gives us atomicity
      // without a persistent connection to hold a BEGIN open.
      await sql.transaction(statements.map((statement) => sql.query(statement.sql, statement.params as never[])));
    },
  };
  neonRepo = makeRepository("neon-postgres", executor);
  return neonRepo;
}

/* -------------------------------------------------------------------------- */
/* PGlite adapter (zero-config local dev and tests)                          */
/* -------------------------------------------------------------------------- */

/**
 * PGlite holds its database **in memory**, and Next.js loads each route as its
 * own server bundle with its own module registry. A module-level singleton
 * therefore gives every route a *different* database: `/api/bootstrap` would
 * create the household and `/board` would then find nothing.
 *
 * Storing the singleton on `globalThis` makes it a genuine per-process
 * singleton, so every route bundle shares one database for the lifetime of the
 * server. In-memory is also what makes this safe against Next running several
 * worker processes: a file-backed PGlite would need an exclusive lock and the
 * second process would fail.
 *
 * Production never reaches this code — it requires a real connection string.
 */
const PGLITE_KEY = Symbol.for("griha.pglite");

type GlobalWithPglite = typeof globalThis & { [PGLITE_KEY]?: Promise<Repository> };

async function getPgliteRepository(): Promise<Repository> {
  const store = globalThis as GlobalWithPglite;
  if (store[PGLITE_KEY]) return store[PGLITE_KEY];

  store[PGLITE_KEY] = (async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const client = await PGlite.create();
    const executor: SqlExecutor = {
      async query<T>(statement: string, params: unknown[] = []) {
        const result = await client.query<T>(statement, params as never[]);
        return { rows: result.rows };
      },
      async transaction(statements: SqlStatement[]) {
        if (statements.length === 0) return;
        // PGlite is an in-process client on a single connection, so an explicit
        // BEGIN/COMMIT is a genuine transaction here.
        await client.exec("BEGIN");
        try {
          for (const statement of statements) {
            await client.query(statement.sql, (statement.params ?? []) as never[]);
          }
          await client.exec("COMMIT");
        } catch (error) {
          await client.exec("ROLLBACK").catch(() => undefined);
          throw error;
        }
      },
    };
    return makeRepository("pglite-embedded", executor);
  })();

  return store[PGLITE_KEY];
}

/**
 * Adapter selection.
 *
 * Production must never *silently* fall back to an embedded database: a
 * serverless cold start would erase every household. It therefore refuses to
 * start without a connection string.
 *
 * The single exception is an explicit `ALLOW_EMBEDDED_DB=1`. That is not a
 * silent fallback — it is someone typing a variable that says, in as many words,
 * "I accept that this database dies with the process". It exists so
 * `npm run build && npm start` works on a laptop with no database at all, which
 * is how the browser suite is run against a real production build. `/api/health`
 * reports `durable: false` whenever this path is taken, so a deployment cannot
 * be mistaken for a durable one.
 */
export async function getRepository(): Promise<Repository> {
  const isProduction = process.env.NODE_ENV === "production";
  const hasDatabaseUrl = Boolean(resolveDatabaseUrl());
  const allowEmbedded = process.env.ALLOW_EMBEDDED_DB?.trim() === "1";

  if (isProduction && !hasDatabaseUrl && !allowEmbedded) {
    throw new Error(
      "Refusing to start in production without a database connection string. Set DATABASE_URL (or POSTGRES_URL). " +
        "Griha will not fall back to an embedded database in production, because that would silently lose every " +
        "household on the next cold start. Set ALLOW_EMBEDDED_DB=1 only if you accept losing all data when the " +
        "process restarts.",
    );
  }

  if (hasDatabaseUrl) return getNeonRepository();
  return getPgliteRepository();
}

export { makeRepository };