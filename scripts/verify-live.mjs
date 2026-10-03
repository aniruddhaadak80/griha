#!/usr/bin/env node
/**
 * Live end-to-end verification against a deployed Griha.
 *
 * Usage:
 *   node scripts/verify-live.mjs                       # uses GRIHA_BASE_URL
 *   node scripts/verify-live.mjs https://griha-abc.vercel.app
 *   GRIHA_BASE_URL=https://griha-abc.vercel.app npm run verify:live
 *
 * This is not a smoke test. It proves the claims the README makes, in order,
 * against the real deployment, using real HTTP requests and no mocks:
 *
 *   1  landing page responds
 *   2  /api/health reports the hosted store, not an embedded one
 *   3  live data is present and honestly labelled live or fallback
 *   4  a chore can be created through the public API
 *   5  it reads back through the UI-facing API
 *   6  it can be updated and the change is persisted
 *   7  the engine returns a versioned score, itemised factors and a seal
 *   8  MCP initialize succeeds
 *   9  MCP tools/list returns the expected tools with schemas
 *  10  an MCP mutating tool writes through the same path as the UI
 *  11  the mutation is readable back, proving persistence
 *  12  integrity replay passes before deletion
 *  13  the chore is deleted and is then absent
 *  14  the audit chain is still replayable after deletion
 *  15  navigation and footer both carry the public repository URL
 *  16  the repository URL itself returns 200
 *  17  every primary route responds without a framework error
 *
 * Everything it creates it deletes, so it is safe to run repeatedly against
 * production. Exit code is non-zero if any check fails.
 */

import process from "node:process";

const BASE = (process.argv[2] || process.env.GRIHA_BASE_URL || "").replace(/\/+$/, "");
const REPO_URL = "https://github.com/aniruddhaadak80/griha";
const EXPECTED_TOOLS = [
  "get_household",
  "list_chores",
  "compute_fairness",
  "get_city_context",
  "create_chore",
  "claim_chore",
  "complete_chore",
  "add_member",
  "update_chore",
  "delete_chore",
  "verify_integrity",
];

if (!BASE) {
  console.error("No base URL. Pass one as an argument or set GRIHA_BASE_URL.");
  process.exit(2);
}

/* -------------------------------------------------------------------------- */

let passed = 0;
let failed = 0;
const failures = [];

/** One anonymous household for the whole run, kept in a cookie jar. */
const cookies = new Map();

function rememberCookies(response) {
  const raw = response.headers.getSetCookie?.() ?? [];
  for (const entry of raw) {
    const [pair] = entry.split(";");
    const index = pair.indexOf("=");
    if (index > 0) cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
}

function cookieHeader() {
  return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function request(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    ...options,
    headers: {
      accept: "application/json, text/html;q=0.9",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(cookies.size > 0 ? { cookie: cookieHeader() } : {}),
      ...(options.headers ?? {}),
    },
  });
  rememberCookies(response);
  return response;
}

async function json(path, options) {
  const response = await request(path, options);
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: response.status, body, text, response };
}

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

/* -------------------------------------------------------------------------- */

const created = [];
let choreId = null;
let boardToken = null;
let shareToken = null;

async function main() {
  console.log(`Verifying ${BASE}\n${"=".repeat(60)}`);

  /* --- 1. landing ------------------------------------------------------- */
  section("1. Landing page");
  const landing = await request("/");
  const landingHtml = await landing.text();
  check("GET / returns 200", landing.status === 200, `got ${landing.status}`);
  check("landing renders product copy", landingHtml.includes("Know who owes what"));
  check(
    "landing carries the repository URL",
    landingHtml.includes(REPO_URL),
    "the public repo link is missing from the landing page",
  );

  /* --- 2. persistence --------------------------------------------------- */
  section("2. Persistence");
  const health = await json("/api/health");
  check("GET /api/health returns 200", health.status === 200, `got ${health.status}`);
  const adapter = health.body?.data?.persistence?.adapter;
  const durable = health.body?.data?.persistence?.durable;
  check(
    "health reports the hosted store",
    adapter === "neon-postgres",
    `adapter was "${adapter}" — production must not use the embedded database`,
  );
  check("health reports durable: true", durable === true, `durable was ${durable}`);
  check(
    "health actually queried the database",
    typeof health.body?.data?.persistence?.detail === "string" &&
      health.body.data.persistence.detail.length > 0,
    "no query detail reported",
  );

  /* --- 3. live data ----------------------------------------------------- */
  section("3. Live data provenance");
  const context = await json("/api/context");
  const weather = context.body?.data?.context?.weather;
  const holidays = context.body?.data?.context?.holidays;
  check("context returns 200", context.status === 200, `got ${context.status}`);
  check("forecast is non-empty", (weather?.days?.length ?? 0) > 0, "no forecast days");
  check(
    "forecast rows are normalised",
    (weather?.days ?? []).every(
      (d) =>
        typeof d.date === "string" &&
        typeof d.precipitationProbability === "number" &&
        typeof d.windSpeed === "number" &&
        typeof d.temperatureMean === "number",
    ),
    "a forecast row is missing a normalised field",
  );
  check(
    "forecast status is honestly labelled",
    weather?.status === "live" || weather?.status === "fallback",
    `status was "${weather?.status}"`,
  );
  check(
    "forecast carries its source and fetch time",
    Boolean(weather?.source && weather?.fetchedAt && weather?.sourceUrl),
    "provenance metadata missing",
  );
  check(
    "holiday feed is honestly labelled",
    holidays?.status === "live" || holidays?.status === "fallback",
    `status was "${holidays?.status}"`,
  );

  /* --- bootstrap a session --------------------------------------------- */
  section("4. Session and household");
  const boot = await request("/api/bootstrap?next=/board");
  check("bootstrap responds", boot.status === 307 || boot.status === 200, `got ${boot.status}`);
  check("bootstrap set a session cookie", cookies.has("griha_session"));

  const household = await json("/api/household");
  shareToken = household.body?.data?.household?.shareToken ?? null;
  check("household exists for this session", Boolean(household.body?.data?.household));
  check("household exposes a share token", Boolean(shareToken));
  check(
    "share token and board token are different values",
    Boolean(household.body?.data?.household?.apiToken) &&
      household.body.data.household.apiToken !== shareToken,
  );

  /* --- 5. create -------------------------------------------------------- */
  section("5. Create through the public API");
  const stamp = Date.now().toString(36);
  const title = `verify-live chore ${stamp}`;
  const createBody = {
    title,
    category: "admin",
    effortMinutes: 17,
    dueOn: new Date().toISOString().slice(0, 10),
    outdoor: true,
    note: "created by scripts/verify-live.mjs",
    idempotencyKey: `verify-${stamp}`,
  };

  const createdRes = await json("/api/chores", { method: "POST", body: JSON.stringify(createBody) });
  check("POST /api/chores returns 201", createdRes.status === 201, `got ${createdRes.status}`);
  choreId = createdRes.body?.data?.id ?? null;
  check("created chore has an id", Boolean(choreId));
  check("create returns an audit seal", (createdRes.body?.meta?.seal ?? "").length === 96);
  if (choreId) created.push({ id: choreId, title, idempotencyKey: createBody.idempotencyKey });

  /* --- 6. read back ----------------------------------------------------- */
  section("6. Read back through the UI-facing API");
  const list = await json("/api/chores");
  const listed = (list.body?.data?.chores ?? []).find((c) => c.id === choreId);
  check("GET /api/chores returns 200", list.status === 200, `got ${list.status}`);
  check("the new chore is listed", Boolean(listed));
  check("persisted effort matches", listed?.effortMinutes === 17, `got ${listed?.effortMinutes}`);
  check("persisted outdoor flag matches", listed?.outdoor === true);
  check("roster came back with the board", (list.body?.data?.members?.length ?? 0) > 0);

  const single = await json(`/api/chores/${choreId}`);
  check("GET /api/chores/:id returns 200", single.status === 200, `got ${single.status}`);
  check("detail route agrees with the list", single.body?.data?.chore?.title === title);

  /* --- 7. update -------------------------------------------------------- */
  section("7. Update and confirm persistence");
  const patched = await json(`/api/chores/${choreId}`, {
    method: "PATCH",
    body: JSON.stringify({ effortMinutes: 33, note: "updated by verify-live" }),
  });
  check("PATCH returns 200", patched.status === 200, `got ${patched.status}`);
  check("update returns a new seal", (patched.body?.meta?.seal ?? "").length === 96);

  const afterPatch = await json(`/api/chores/${choreId}`);
  check("update persisted", afterPatch.body?.data?.chore?.effortMinutes === 33, `got ${afterPatch.body?.data?.chore?.effortMinutes}`);
  check(
    "seal changed as a result of the update",
    afterPatch.body?.meta?.seal !== createdRes.body?.meta?.seal,
    "the audit seal did not advance",
  );

  /* --- 8. engine -------------------------------------------------------- */
  section("8. Deterministic engine");
  const fairness = await json("/api/fairness?refresh=false");
  const result = fairness.body?.data?.fairness;
  check("GET /api/fairness returns 200", fairness.status === 200, `got ${fairness.status}`);
  check("engine reports a version", typeof result?.version === "string" && result.version.length > 0);
  check("engine returns a bounded score", typeof result?.fairnessScore === "number" && result.fairnessScore >= 0 && result.fairnessScore <= 100, `score was ${result?.fairnessScore}`);
  check("engine itemises its factors", (result?.factors?.length ?? 0) >= 4);
  check(
    "every factor carries a weight, a raw score and its arithmetic",
    (result?.factors ?? []).every(
      (f) => typeof f.weight === "number" && typeof f.raw === "number" && typeof f.detail === "string" && f.detail.length > 10,
    ),
  );
  check(
    "factor contributions sum to the score",
    Math.abs((result?.factors ?? []).reduce((s, f) => s + f.contribution, 0) - result.fairnessScore) <= 0.2,
  );
  check("engine scored each member", (result?.members?.length ?? 0) > 0);
  check(
    "per-member deviation is numeric and signed",
    (result?.members ?? []).every((m) => typeof m.deviationPoints === "number"),
  );
  check("engine returns a verification reference", (fairness.body?.meta?.seal ?? "").length === 96);

  const fairness2 = await json("/api/fairness?refresh=false");
  check(
    "engine is deterministic across calls",
    fairness2.body?.data?.fairness?.fairnessScore === result?.fairnessScore,
  );

  /* --- 9/10. MCP -------------------------------------------------------- */
  section("9. MCP JSON-RPC");
  const rpc = (method, params, id = Math.floor(Math.random() * 1e6)) =>
    json("/api/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });

  const init = await rpc("initialize", {});
  check("initialize succeeds", Boolean(init.body?.result?.serverInfo?.name), JSON.stringify(init.body).slice(0, 160));
  check("initialize advertises a protocol version", typeof init.body?.result?.protocolVersion === "string");
  check("initialize advertises tools capability", init.body?.result?.capabilities?.tools !== undefined);

  const toolsRes = await rpc("tools/list", {});
  const tools = toolsRes.body?.result?.tools ?? [];
  check("tools/list returns tools", tools.length > 0, `got ${tools.length}`);
  check(
    "tools/list returns every expected tool",
    EXPECTED_TOOLS.every((name) => tools.some((t) => t.name === name)),
    `missing: ${EXPECTED_TOOLS.filter((n) => !tools.some((t) => t.name === n)).join(", ")}`,
  );
  check(
    "every tool has a JSON Schema and annotations",
    tools.every((t) => t.inputSchema?.type === "object" && t.annotations !== undefined),
  );
  check(
    "there is at least one read, one analysis and one mutating tool",
    tools.some((t) => t.annotations?.readOnlyHint === true) &&
      tools.some((t) => t.name === "compute_fairness") &&
      tools.some((t) => t.annotations?.readOnlyHint === false),
  );

  /* --- board token for mutation ---------------------------------------- */
  const household2 = await json("/api/household");
  boardToken = household2.body?.data?.household?.apiToken ?? null;
  check("board token available for MCP mutation", Boolean(boardToken));

  section("10. MCP mutation takes the same path as the UI");
  const agentTitle = `verify-live agent ${stamp}`;
  const agentCreate = await json("/api/mcp", {
    method: "POST",
    headers: { "x-griha-token": boardToken ?? "" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "create_chore",
        arguments: {
          boardToken,
          title: agentTitle,
          category: "admin",
          effortMinutes: 9,
          dueOn: new Date().toISOString().slice(0, 10),
          idempotencyKey: `verify-agent-${stamp}`,
        },
      },
    }),
  });

  const agentChore = agentCreate.body?.result?.structuredContent?.chore;
  check("MCP create_chore succeeds", Boolean(agentChore?.id), JSON.stringify(agentCreate.body).slice(0, 200));
  check("MCP mutation returned a seal", (agentCreate.body?.result?.structuredContent?.seal ?? "").length === 96);
  if (agentChore?.id) created.push({ id: agentChore.id, title: agentTitle });

  if (agentChore?.id) {
    const agentList = await json("/api/chores");
    const found = (agentList.body?.data?.chores ?? []).find((c) => c.id === agentChore.id);
    check("MCP-created chore is readable through the board API", Boolean(found));
    check("MCP write persisted the same fields", found?.effortMinutes === 9, `got ${found?.effortMinutes}`);
  }

  const agentFairness = await json("/api/mcp", {
    method: "POST",
    headers: { "x-griha-token": boardToken ?? "" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "compute_fairness", arguments: { boardToken, refreshContext: false } },
    }),
  });
  check(
    "MCP compute_fairness returns the same engine",
    agentFairness.body?.result?.structuredContent?.version === result?.version,
  );

  /* --- 11. integrity before deletion ----------------------------------- */
  section("11. Integrity chain");
  const verifyBefore = await json("/api/verify");
  const before = verifyBefore.body?.data;
  check("GET /api/verify returns 200", verifyBefore.status === 200, `got ${verifyBefore.status}`);
  check("audit trail is non-empty", (before?.events ?? 0) > 0, `events: ${before?.events}`);
  check("replay succeeds before deletion", before?.ok === true, before?.reason ?? "chain reported broken");
  check("replay reports a head seal", (before?.headSeal ?? "").length === 96);
  check("genesis is 384 bits of zero", (before?.genesis ?? "").length === 96 && /^0+$/.test(before.genesis ?? ""));

  /* --- 12. delete and confirm ------------------------------------------ */
  section("12. Delete and confirm");
  for (const record of created) {
    const del = await json(`/api/chores/${record.id}`, { method: "DELETE" });
    check(`DELETE ${record.id.slice(0, 8)}… returns 200`, del.status === 200, `got ${del.status}`);
    check("delete reports a tombstone", del.body?.data?.tombstone === true);
  }

  for (const record of created) {
    const gone = await json(`/api/chores/${record.id}`);
    check(`deleted chore ${record.id.slice(0, 8)}… is gone`, gone.status === 404, `got ${gone.status}`);
  }

  const verifyAfter = await json("/api/verify");
  check("replay still succeeds after deletion", verifyAfter.body?.data?.ok === true, verifyAfter.body?.data?.reason ?? "chain broke on delete");
  check(
    "audit trail grew rather than shrank on delete",
    (verifyAfter.body?.data?.events ?? 0) > (before?.events ?? 0),
  );

  /* --- 13. read-only share route --------------------------------------- */
  section("13. Read-only share route");
  const shareUrl = `/share/${shareToken}`;
  const shared = await request(shareUrl);
  const sharedHtml = await shared.text();
  check("share route returns 200 without a session", shared.status === 200, `got ${shared.status}`);
  check("share route renders the board", sharedHtml.includes("Shared read-only board"));
  check("share route offers no mutating control", !sharedHtml.includes("Mark done"));
  check("share route is excluded from indexing", sharedHtml.includes("noindex") || sharedHtml.includes("no-index"));

  /* --- 14. repository links -------------------------------------------- */
  section("14. GitHub access");
  const board = await request("/board");
  const boardHtml = await board.text();
  const repoLinks = (boardHtml.match(new RegExp(REPO_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;
  check("board contains the repository URL", repoLinks > 0);
  check("repository links open in a new tab safely", boardHtml.includes('rel="noopener noreferrer"'));

  const repoResponse = await fetch(REPO_URL, { redirect: "follow" });
  check("the public repository returns 200", repoResponse.status === 200, `got ${repoResponse.status}`);

  const mcpManifest = await request("/mcp.json");
  const manifest = await mcpManifest.json().catch(() => null);
  check("mcp.json is published", mcpManifest.status === 200, `got ${mcpManifest.status}`);
  check("mcp.json carries a live endpoint", (manifest?.remotes?.[0]?.url ?? "").startsWith("http"), JSON.stringify(manifest?.remotes?.[0]?.url));

  /* --- 15. every primary route ----------------------------------------- */
  section("15. Route health");
  for (const route of ["/", "/board", "/fairness", "/agent", "/export", "/install", "/settings", "/verify", "/offline"]) {
    const response = await request(route);
    const body = await response.text();
    check(
      `GET ${route}`,
      response.status === 200 && !body.includes("Application error"),
      `status ${response.status}`,
    );
  }

  const manifestResponse = await request("/manifest.webmanifest");
  const manifestBody = await manifestResponse.text();
  check("web manifest is served", manifestResponse.status === 200);
  check("manifest declares standalone display", manifestBody.includes('"display":"standalone"'));
  check("manifest declares icons", manifestBody.includes('"icons"'));

  const swResponse = await request("/sw.js");
  check("service worker is served", swResponse.status === 200, `got ${swResponse.status}`);
  check("service worker is not cached", (swResponse.headers.get("cache-control") ?? "").includes("no-store"));
}

/* -------------------------------------------------------------------------- */

main()
  .catch((error) => {
    failed += 1;
    failures.push(`verifier threw: ${error?.message ?? error}`);
    console.error("\nVerifier crashed:", error);
  })
  .finally(() => {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`${passed} passed, ${failed} failed`);
    if (failures.length > 0) {
      console.log("\nFailures:");
      for (const failure of failures) console.log(`  - ${failure}`);
    }
    process.exit(failed > 0 ? 1 : 0);
  });