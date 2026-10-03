import { defineConfig, devices } from "@playwright/test";

/**
 * Browser journey tests.
 *
 * Two projects, desktop and mobile, because Griha is installed on phones and
 * the primary interaction is a tap on a small target. The mobile project runs
 * on a real touch-emulating viewport, not a narrow desktop one, because the two
 * behave differently against `hover`-only affordances and hit targets.
 *
 * `GRIHA_BASE_URL` lets the same suite run against the production alias, which
 * is how the live gates are checked rather than assumed.
 */
const baseURL = process.env.GRIHA_BASE_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],
});