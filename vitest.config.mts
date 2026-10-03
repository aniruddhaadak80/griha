import { defineConfig } from "vitest/config";

/**
 * Unit and integration tests for Griha.
 *
 * `node` environment, not jsdom: everything under test here is the engine, the
 * integrity chain, the validation layer and the repository, all of which are
 * server-side by design. The browser surface is covered by Playwright instead.
 */
export default defineConfig({
  // Vite resolves the `@/*` path alias natively from tsconfig, so no plugin is
  // needed — and no plugin has to be kept in step with the TypeScript config.
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // PGlite boots a WASM Postgres per file; a little headroom keeps CI from
    // flaking on a cold cache without making the suite feel loose.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});