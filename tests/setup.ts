/**
 * Test environment.
 *
 * Clears any connection string a developer has in `.env.local` before the
 * repository module can read one, so the suite always runs against the embedded
 * PGlite adapter and never writes to a real database. `DATABASE_SCHEMA` is
 * pinned to a throwaway schema for the same reason: two concurrent test runs
 * must not collide, and nothing here should be able to touch production rows.
 */
process.env.DATABASE_URL = "";
process.env.POSTGRES_URL = "";
process.env.DATABASE_SCHEMA = "griha_test";