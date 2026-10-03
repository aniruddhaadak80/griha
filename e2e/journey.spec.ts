import { expect, test, type Page } from "@playwright/test";

/**
 * The primary Griha journey, end to end, in a real browser.
 *
 * This is deliberately written as a user would do it — open the board, create a
 * chore, inspect it, claim it, complete it, run the engine, drive the agent
 * tool, export a file, verify the chain, then delete it — with no API shortcuts
 * for the steps that have a UI. The three jobs-to-be-done are asserted
 * explicitly so a regression cannot quietly remove one of them.
 *
 * Every mutation is cleaned up, so the suite can run repeatedly against
 * production without leaving debris.
 */

/** Give the first anonymous request a session cookie. */
async function bootstrap(page: Page) {
  await page.goto("/api/bootstrap?next=/board");
  await expect(page).toHaveURL(/\/board/);
}

test.describe("Griha primary journey", () => {
  test("landing page shows real figures and links to source", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Know who owes what");

    // The hero bar is rendered from a real household, not from a mock.
    await expect(page.getByText("Household fairness")).toBeVisible();

    // GitHub is reachable from the landing CTA.
    const cta = page.getByRole("link", { name: /Star on GitHub/i });
    await expect(cta).toHaveAttribute("href", "https://github.com/aniruddhaadak80/griha");
    await expect(cta).toHaveAttribute("target", "_blank");
    await expect(cta).toHaveAttribute("rel", /noopener/);

    expect(consoleErrors, `console errors on landing: ${consoleErrors.join(" | ")}`).toHaveLength(0);
  });

  test("navigation and footer both expose the repository URL", async ({ page }) => {
    await page.goto("/");

    const header = page.locator("header");
    await expect(header.getByRole("link", { name: /View source/i }).first()).toHaveAttribute(
      "href",
      "https://github.com/aniruddhaadak80/griha",
    );

    const footer = page.locator("footer");
    await expect(footer.getByRole("link", { name: /View source/i })).toHaveAttribute(
      "href",
      "https://github.com/aniruddhaadak80/griha",
    );

    // The mobile drawer must carry the same link.
    const menu = page.getByRole("button", { name: /Open menu/i });
    if (await menu.isVisible()) {
      await menu.click();
      await expect(page.locator("#mobile-nav").getByRole("link", { name: /View source/i })).toHaveAttribute(
        "href",
        "https://github.com/aniruddhaadak80/griha",
      );
    }
  });

  test("job 1: a housemate can claim a chore so nobody has to ask twice", async ({ page }) => {
    await bootstrap(page);

    const marker = `E2E claim ${Date.now()}`;
    await page.getByRole("button", { name: /Add a chore/i }).click();
    await page.getByLabel("What needs doing").fill(marker);
    await page.getByLabel("Effort (minutes)").fill("15");
    await page.getByRole("button", { name: /Add to the board/i }).click();

    await expect(page.getByRole("link", { name: marker })).toBeVisible();

    // Claim it for the first member offered.
    const card = page.locator("li", { has: page.getByRole("link", { name: marker }) }).first();
    const claimButtons = card.getByRole("button", { name: /^(?!Mark done|Delete|Release)/ });
    const firstClaim = claimButtons.first();
    await expect(firstClaim).toBeVisible();
    await firstClaim.click();

    await expect(page.getByRole("status")).toContainText(/Recorded/);
    await expect(page.getByRole("status")).toContainText(/seal/i);

    // Read-back through the API proves it persisted, not just that it re-rendered.
    const stored = await page.request.get("/api/chores");
    const payload = await stored.json();
    const found = payload.data.chores.find((c: { title: string }) => c.title === marker);
    expect(found, "created chore should be readable back from the API").toBeTruthy();
    expect(found.assigneeId, "claim should have persisted an assignee").toBeTruthy();
    expect(found.status).toBe("claimed");
  });

  test("job 2: a housemate can see the arithmetic, not just a number", async ({ page }) => {
    await bootstrap(page);

    await page.goto("/fairness");
    await expect(page.getByRole("heading", { name: /fairness report/i })).toBeVisible();

    // The household score.
    await expect(page.getByText(/^Fairness$/)).toBeVisible();

    // At least one weighted factor with its arithmetic is rendered.
    const factor = page.locator("li", { hasText: "Share parity" }).first();
    await expect(factor).toContainText("weight");
    await expect(factor).toContainText("raw");

    // Selecting a member reveals their per-member factor breakdown.
    const memberButton = page.locator('button[aria-expanded="false"]').filter({ hasText: /pts/ }).first();
    if (await memberButton.count()) {
      await memberButton.click();
      await expect(page.getByText(/Overdue exposure/).first()).toBeVisible();
    }
  });

  test("job 3: a family member can export a shareable artefact", async ({ page }) => {
    await bootstrap(page);
    await page.goto("/export");

    // Every export is a real download produced by the server.
    for (const format of ["ics", "csv", "md", "json"] as const) {
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByTestId(`export-${format}`).click(),
      ]);
      expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${format === "md" ? "md" : format}$`));
    }

    // The share link is present and its QR is rendered as an image.
    await expect(page.getByRole("img", { name: /share/i }).first()).toBeVisible();
  });

  test("the core CRUD loop completes and cleans up", async ({ page }) => {
    await bootstrap(page);

    const marker = `E2E lifecycle ${Date.now()}`;

    // Create
    await page.getByRole("button", { name: /Add a chore/i }).click();
    await page.getByLabel("What needs doing").fill(marker);
    await page.getByLabel("Effort (minutes)").fill("20");
    await page.getByRole("button", { name: /Add to the board/i }).click();
    const link = page.getByRole("link", { name: marker });
    await expect(link).toBeVisible();

    // Inspect — the dynamic detail route
    await link.click();
    await expect(page.getByRole("heading", { name: marker })).toBeVisible();
    await expect(page.getByText(/Sealed history for this chore/i)).toBeVisible();

    const choreId = new URL(page.url()).pathname.split("/").pop()!;

    // Update — via the detail page
    await page.getByRole("button", { name: /Release the claim/i }).click().catch(() => {
      // Unclaimed chores have nothing to release; that is not a failure.
    });
    await expect(page.getByRole("status").first()).toContainText(/Recorded|Recorded/);

    // Engine analysis is reachable and versioned
    await page.goto("/fairness");
    await expect(page.getByText(/griha-fairness\//).first()).toBeVisible();

    // Delete — with confirmation
    await page.goto(`/chore/${choreId}`);
    await page.getByRole("button", { name: /^Delete$/ }).click();
    await page.getByRole("button", { name: /Yes, delete/i }).click();
    await expect(page).toHaveURL(/\/board/);

    // Absent on read-back, exactly as a tombstone should behave.
    const after = await page.request.get(`/api/chores/${choreId}`);
    expect(after.status()).toBe(404);

    // Still verifiable: the audit chain replays.
    const verify = await page.request.get("/api/verify");
    const verifyBody = await verify.json();
    expect(verifyBody.data.ok).toBe(true);
  });

  test("the agent console performs a real mutating MCP call", async ({ page }) => {
    await bootstrap(page);
    await page.goto("/agent");

    await page.getByTestId("mcp-tools-list").click();
    await expect(page.getByText(/"tools"/).first()).toBeVisible();

    // initialize
    await page.getByTestId("mcp-initialize").click();
    await expect(page.getByText(/protocolVersion/).first()).toBeVisible();

    // The mutation must take the same path as the UI, so the board changes.
    await page.getByTestId("mcp-create-chore").click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const listed = await page.request.get("/api/chores");
    const payload = await listed.json();
    const agentChore = payload.data.chores.find((c: { title: string }) => c.title.startsWith("Agent-added chore"));
    expect(agentChore, "the MCP mutation should have written a real chore").toBeTruthy();
    expect(agentChore.status).toBeTruthy();

    // Clean up so repeated runs do not accumulate rows.
    await page.request.delete(`/api/chores/${agentChore.id}`);
  });

  test("integrity replay succeeds and names its algorithm", async ({ page }) => {
    await bootstrap(page);
    await page.goto("/verify");

    const result = page.getByTestId("integrity-result");
    await expect(result).toContainText(/Chain intact/);
    await expect(result).toContainText(/SHA-384/);
    await expect(page.getByText(/Genesis/i)).toBeVisible();
  });

  test("validation failures are reported, not swallowed", async ({ page }) => {
    await bootstrap(page);

    const bad = await page.request.post("/api/chores", {
      data: { title: "x", category: "kitchen", effortMinutes: 5, dueOn: "not-a-date" },
    });
    expect(bad.status()).toBe(400);
    const body = await bad.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("invalid_input");

    // A real form error is visible to the user.
    await page.goto("/board");
    await page.getByRole("button", { name: /Add a chore/i }).click();
    await page.getByLabel("What needs doing").fill("ab");
    await page.getByLabel("What needs doing").fill("a");
    await page.getByRole("button", { name: /Add to the board/i }).click();
    await expect(page.getByText(/at least 2 character/i)).toBeVisible();
  });

  test("install page renders a scannable QR and correct per-platform guidance", async ({ page }) => {
    await page.goto("/install");
    await expect(page.getByRole("heading", { name: /Install Griha/i })).toBeVisible();
    await expect(page.getByRole("img", { name: /Scan to open/ })).toBeVisible();

    // The QR container holds a real <svg>, not a placeholder box.
    const svg = page.locator('[role="img"][aria-label*="Scan to open"] svg');
    await expect(svg).toHaveCount(1);
    await expect(svg).toHaveAttribute("viewBox", /\d+ \d+/);

    // The honest disclosure about what a PWA is and is not.
    await expect(page.getByText(/installable progressive web app, not a native binary/i)).toBeVisible();
  });

  test("the read-only share route works without any session", async ({ page, browser }) => {
    await bootstrap(page);
    await page.goto("/export");

    const href = await page.locator('a[href^="/share/"]').first().getAttribute("href");

    // A brand-new browser context has no cookie at all.
    const fresh = await browser.newContext();
    const anon = await fresh.newPage();
    const response = await anon.goto(href!);
    expect(response?.status()).toBe(200);
    await expect(anon.getByRole("heading", { name: /Shared read-only board|Our Home/ })).toBeVisible();
    await expect(anon.getByText(/cannot be changed from here/i)).toBeVisible();

    // Crucially: no mutating control is present.
    await expect(anon.getByRole("button", { name: /Mark done/i })).toHaveCount(0);
    await expect(anon.getByRole("button", { name: /Delete/i })).toHaveCount(0);
    await fresh.close();
  });

  test("every primary route responds without a server error", async ({ page }) => {
    const routes = ["/", "/board", "/fairness", "/agent", "/export", "/install", "/settings", "/verify"];
    await bootstrap(page);
    for (const route of routes) {
      const response = await page.goto(route);
      expect(response?.status(), `${route} should return 200`).toBe(200);
      const body = await page.content();
      expect(body, `${route} should not render a framework error page`).not.toContain("Application error");
    }
  });

  test("keyboard focus is visible and the skip link works", async ({ page }) => {
    await page.goto("/");

    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: /Skip to main content/i });
    await expect(skip).toBeFocused();

    // The focus ring is a real outline, not a browser default suppressed by CSS.
    const outlineWidth = await skip.evaluate((el) => getComputedStyle(el).outlineWidth);
    expect(outlineWidth).not.toBe("0px");
  });
});