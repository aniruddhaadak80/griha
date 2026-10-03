<div align="center">

# Griha · गृह

### The household chore ledger that shows its working.

**Live app → [griha.vercel.app](https://griha.vercel.app)** · **Source → [github.com/aniruddhaadak80/griha](https://github.com/aniruddhaadak80/griha)**

[![Live](https://img.shields.io/badge/live-griha.vercel.app-1f6b5e?style=flat-square)](https://griha.vercel.app)
[![Next.js 16](https://img.shields.io/badge/Next.js-16.3.8-000000?style=flat-square)](https://nextjs.org)
[![React 19](https://img.shields.io/badge/React-19-087ea4?style=flat-square)](https://react.dev)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square)](https://www.typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-c9a227?style=flat-square)](./LICENSE)
[![TabPFN](https://img.shields.io/badge/TabPFN%20v2%20in--your--browser-7c5cff?style=flat-square)](https://github.com/PriorLabs/TabPFN)
[![MCP](https://img.shields.io/badge/MCP-11%20tools-34d399?style=flat-square)](#-the-agent-interface)

</div>

---

## The problem

Someone always does the bins.

Not because they are the least busy person, but because they were standing there.
And the person who actually did the most last week has no way to show it, because
the chore lives in a group chat nobody reads.

The result is the most common small conflict in any shared home: a chore that gets
dropped, an imbalance that goes unspoken, and an argument that can only be settled
by whoever is most annoyed.

**Griha makes the ledger the shared surface.** One board. Claim a chore in one tap.
And a fairness number that shows its arithmetic, so the argument becomes "here is
the maths" instead of "you always do that".

---

## ✨ Features

- **A real chore board.** Create, inspect, claim, complete, unclaim and delete, all
  through a typed REST API and a UI that only ever reflects what the server has
  accepted. Filters and the selected member live in the URL, so a view can be shared.
- **A deterministic fairness engine.** Four weighted factors and four per-member
  factors, every one carrying its weight, its raw sub-score and the sentence that
  produced it. Household score is the sum of the parts, to the decimal.
- **Capacity weights.** A night-shift worker and a stay-at-home parent are not the
  same person. Set a relative capacity and the engine stops reading a lighter load
  as unfairness.
- **Live weather and public holidays**, from two key-free public APIs, used to score
  *outdoor* chores. `Take out the recycling` is not a good idea on the day it is
  going to pour.
- **Open-source AI in the browser.** [TabPFN v2](https://github.com/PriorLabs/TabPFN)
  is loaded as an open-weights ONNX model and fitted on **your household's own
  completion history**, in your tab, to answer a question the engine cannot: *given
  this chore, on this date, at this effort, who is actually likely to do it?*
- **A SHA-384 sealed audit chain.** Every create, claim, completion and delete is
  appended to a hash chain. Replay it and it either holds or it names the exact event
  that was altered.
- **An MCP JSON-RPC 2.0 endpoint with 11 typed tools**, including a mutating path
  that is the *same service function* the buttons call.
- **One installable app for every device.** Android, iPhone, Windows, macOS, Linux
  and any browser, from one URL, with a scannable QR code on the install page and an
  offline shell.
- **Real exports.** `.ics` for a phone calendar, `.csv` for a spreadsheet, `.md` for
  the family group chat, `.json` including the whole audit chain.

---

## 🚀 Quickstart

```bash
git clone https://github.com/aniruddhaadak80/griha
cd griha
npm install
npm run dev
```

Open <http://localhost:3000>.

**Zero required environment variables.** With no configuration the app starts an
embedded Postgres (PGlite) in the same process, so the board, the fairness report,
the agent console and every export work immediately. The first visit seeds a starter
board so you are not staring at an empty page.

### Production

```bash
# Any hosted Postgres: Neon, Vercel Postgres, Supabase, RDS. Postgres 14+.
export DATABASE_URL="postgresql://user:pass@host/db?sslmode=require"
npm run build
npm start
```

Griha **refuses to start in production** without a connection string rather than
quietly falling back to something that would lose every household on the next cold
start. `GET /api/health` reports which adapter is live and whether it is durable.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Production | Hosted Postgres. `POSTGRES_URL` is accepted too, because that is what the Vercel and Neon marketplace integrations create. |
| `DATABASE_SCHEMA` | No | Namespace the tables when sharing one database. Defaults to `public`. Validated against `^[a-z_][a-z0-9_]{0,62}$`. |
| `ALLOW_EMBEDDED_DB` | No | Set to `1` to explicitly opt into the embedded database in production mode. Development only — see [`.env.example`](./.env.example). |

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit`, strict |
| `npm run lint` | ESLint, zero warnings tolerated |
| `npm run test` | 109 unit and integration tests |
| `npm run e2e` | Playwright journey, desktop and mobile |
| `npm run verify:live` | 91 checks against a deployed instance |

---

## 🏗 Architecture

```mermaid
graph LR
  Visitor["Browser<br/>board · fairness · agent"]:::app
  Native["Installed PWA<br/>iOS · Android · Win · macOS"]:::app
  Share["Read-only share link<br/>no session"]:::app
  MCP["MCP client<br/>streamable HTTP"]:::app

  Visitor --> Routes
  Native --> Routes
  Share --> Routes
  MCP --> Routes

  Routes["Next.js 16 App Router<br/>10 pages · 11 API routes"]:::cyan
  Service["Service layer<br/>one path for every write"]:::violet
  Engine["Fairness engine<br/>deterministic, versioned"]:::violet
  Seals["Audit chain<br/>SHA-384, per household"]:::emerald
  Repo["Repository adapter"]:::slate
  Neon[("Neon Postgres<br/>production")]:::amber
  PGlite[("PGlite<br/>zero-config local")]:::amber

  Routes --> Service
  Routes --> Engine
  Service --> Seals
  Service --> Repo
  Engine --> Seals
  Repo --> Neon
  Repo --> PGlite

  ML["TabPFN v2<br/>in the browser tab"]:::emerald
  Visitor -.fits on.-> ML

  classDef app fill:#1f6b5e,color:#fff,stroke:#15312c
  classDef cyan fill:#22d3ee,color:#01252b,stroke:#0e7490
  classDef violet fill:#a78bfa,color:#1b1039,stroke:#7c3aed
  classDef emerald fill:#34d399,color:#012b1e,stroke:#059669
  classDef amber fill:#fbbf24,color:#2b1d00,stroke:#b45309
  classDef slate fill:#94a3b8,color:#0b1220,stroke:#475569
```

Two adapters sit behind one typed `Repository` interface. The SQL, the schema, the
indexes and the constraints are written once; the adapter only changes how a query
reaches Postgres and how a transaction is made atomic.

```mermaid
graph TB
  OpenMeteo["Open-Meteo<br/>7-day forecast"]:::amber
  Nager["Nager.Date<br/>public holidays"]:::amber
  Fetch["fetchWithTimeout<br/>5s · 2 attempts"]:::cyan
  Normalise["normalise<br/>typed rows + provenance"]:::cyan
  Cache["10-minute<br/>in-process cache"]:::slate
  Fallback["Sealed offline sample"]:::rose

  OpenMeteo --> Fetch
  Nager --> Fetch
  Fetch -->|ok| Cache
  Fetch -->|fail| Fallback
  Cache --> Normalise
  Fallback --> Normalise
  Normalise --> Engine["Engine input<br/>weatherFit + holiday flag"]:::violet
  Normalise --> UI["Badges that say<br/>live or offline sample"]:::emerald

  classDef amber fill:#fbbf24,color:#2b1d00,stroke:#b45309
  classDef cyan fill:#22d3ee,color:#01252b,stroke:#0e7490
  classDef violet fill:#a78bfa,color:#1b1039,stroke:#7c3aed
  classDef emerald fill:#34d399,color:#012b1e,stroke:#059669
  classDef rose fill:#fb7185,color:#2b0710,stroke:#e11d48
  classDef slate fill:#94a3b8,color:#0b1220,stroke:#475569
```

The fallback is never presented as a live reading. Every surface that shows weather
or a holiday carries the upstream name, the fetch time and a `live` or
`offline sample` badge.

---

## 🧮 The fairness engine

`griha-fairness/2026.10.1`. One pure function, `computeFairness`, in
[`src/lib/engine.ts`](./src/lib/engine.ts). The board, `/api/fairness`, the MCP
`compute_fairness` tool and the export centre all call it — nothing recomputes a
score locally, which is what stops the UI and the API from disagreeing.

| Household factor | Weight | What it measures |
| --- | --- | --- |
| Share parity | 0.40 | Mean absolute deviation from an even split, across the household |
| Overdue pressure | 0.25 | Worst lateness in days, saturating at two weeks |
| Momentum | 0.20 | Completions in the window against a cadence target |
| Effort honesty | 0.15 | Whether recorded minutes track the chore's estimate |

Each member gets the same four-factor shape: share parity, overdue exposure,
follow-through and open load. The weighted sum is the member score; the sign of
their deviation is their verdict.

The engine takes `now` as a parameter and reads no clock, so the same ledger always
produces the same number on every machine. It returns a valid, bounded result for an
empty household, a single member and a household where nobody has done anything —
no `NaN`, no divide-by-zero, and tests that say so.

```mermaid
graph LR
  Ledger["Members · capacities<br/>Chores · completions"]:::cyan
  Context["Weather · holidays"]:::amber
  Engine["computeFairness<br/>pure, injected clock"]:::violet
  Factors["Factors with weight,<br/>raw score and arithmetic"]:::violet
  Score["Household score 0–100"]:::emerald
  Rec["One recommended<br/>next action"]:::emerald
  Seal["Head seal"]:::emerald

  Ledger --> Engine
  Context --> Engine
  Engine --> Factors --> Score
  Engine --> Rec
  Engine --> Seal

  classDef cyan fill:#22d3ee,color:#01252b,stroke:#0e7490
  classDef amber fill:#fbbf24,color:#2b1d00,stroke:#b45309
  classDef violet fill:#a78bfa,color:#1b1039,stroke:#7c3aed
  classDef emerald fill:#34d399,color:#012b1e,stroke:#059669
```

**The signature interaction** is the fair-share bar. Each segment's width is that
member's actual share of completed minutes, so the bar is not an illustration of the
data, it *is* the data. The dashed marker is the equal-share boundary, and the gap
between the two is the thing households actually argue about. Tap a segment and the
exact arithmetic appears.

---

## 🤖 Open-source AI at the core

Griha splits the problem in two, on purpose:

**Fairness is deterministic.** "Who is carrying the week?" is arithmetic. It must be
reproducible, explainable and identical on every device, so it is a pure function and
there is no model in that path.

**Completion is probabilistic.** "Will this actually get done?" is a prediction, and
a rule engine cannot answer it without someone hand-writing rules for one household.
So that part is learned — from that household's own record, in their own browser.

```mermaid
sequenceDiagram
  autonumber
  participant U as Household member
  participant B as Browser tab
  participant W as WebTabPFN (TabPFN v2)
  participant P as Postgres

  U->>B: Opens the fairness report
  B->>P: GET /api/fairness
  P-->>B: Household, members, chores, completions
  B->>B: buildTrainingTable — 8 features, real rows only
  Note over B: positives from real completions
  Note over B: negatives from chores that went past due, assigned, never done
  U->>B: Press "Run TabPFN locally"
  B->>W: load INT4/INT8 on WebGPU or WASM
  W-->>B: session ready, weights cached
  B->>W: fit(features, labels)
  W-->>B: predictProba for each open chore x member
  B-->>U: Least-likely pairings first, with the row count that produced them
  Note over B,P: nothing leaves the tab — no upload, no server inference
```

The eight features are real and documented in the UI:
`capacity`, `categoryShare`, `effortMinutes`, `weekday`, `daysSinceLastOfCategory`,
`assigneeLoadShare`, `isPublicHoliday`, `outdoor`.

The honesty rules the panel enforces:

- If the model cannot load, it shows the actual error. The deterministic engine is
  unaffected.
- `hasWebGpu()` is a feature check, not a working adapter. The panel therefore tries
  `webgpu`/`int4` and then falls back to `wasm`/`int8` explicitly, because WebTabPFN
  does not fall back by itself — without this the panel is dead in headless Chromium,
  Safari and Firefox. If neither backend starts, both failures are shown.
- A table with a single class is not a table a classifier can fit, so the panel says so
  in plain words instead of surfacing the model's opaque error. The first-run household
  is seeded with two genuine lapses for this reason: a history of nothing but
  completions teaches the model nothing.
- With fewer than six labelled rows it refuses to predict rather than predicting noise.
- Every probability is shown with the number of training rows behind it, and the copy
  says plainly that tens of rows is a very small table for a prior-fitted network.
  Predictions close to 0.5 are labelled `UNCERTAIN` rather than dressed up as a verdict.

> **Why open matters here.** The weights are Prior Labs' open TabPFN v2, downloaded
> once and cached by the browser. Nothing about your household is uploaded — not the
> completions, not the features, not the probabilities. A closed API could not offer
> that, and the "who is likely to flake" question is exactly the one you would not
> want sending a family's routine to someone else's server.
>
> **Attribution:** Built with PriorLabs-TabPFN, as the model licence requires.

---

## 🔌 The agent interface

`POST /api/mcp`, JSON-RPC 2.0, eleven tools with JSON Schemas for every argument.

| Tool | Kind | What it does |
| --- | --- | --- |
| `get_household` | read | Household, roster, chore counts |
| `list_chores` | read | The board, assignees resolved to names |
| `compute_fairness` | analysis | The deterministic engine, with every factor |
| `get_city_context` | read | Live forecast and holidays with provenance |
| `verify_integrity` | read | Replay the chain, report the first break |
| `create_chore` | **write** | Add a chore; idempotent |
| `claim_chore` | **write** | Assign a chore |
| `complete_chore` | **write** | Record a completion and flip it to done |
| `add_member` | **write** | Add a member with a capacity weight |
| `update_chore` | **write** | Change due date, effort, category, note, status |
| `delete_chore` | **write** | Soft delete, leaving a tombstone |

**Authorisation.** Tools require a board token, supplied as the `X-Griha-Token`
header or as `boardToken` in the arguments. There is deliberately no ambient-cookie
fallback: an MCP client is an external program, and if it could act on whichever
browser happened to call it, any page on the internet could drive a household's
ledger. Read-only tools also accept the household's *share* token, which grants
strictly less.

**One write path.** `claim_chore` calls `claimChore()` in
[`src/lib/service.ts`](./src/lib/service.ts) — the same function the Claim button
calls. It appends the same audit event and returns the same seal.

```mermaid
sequenceDiagram
  autonumber
  participant C as MCP client
  participant R as /api/mcp
  participant S as service.ts
  participant D as Postgres
  participant B as Board UI

  C->>R: initialize
  R-->>C: protocolVersion, tools capability, instructions
  C->>R: tools/list
  R-->>C: 11 tools with schemas and annotations
  C->>R: tools/call create_chore (idempotencyKey)
  R->>S: createChore()
  S->>D: INSERT chore + append sealed audit event
  S-->>R: chore, seal
  R-->>C: content + structuredContent + _meta.seal
  Note over B: the board renders the same row
  B->>D: GET /api/chores
  D-->>B: includes the agent's chore
  C->>R: tools/call verify_integrity
  R-->>C: ok, events, headSeal, algorithm
```

The in-page console at [`/agent`](https://griha.vercel.app/agent) sends real requests
and prints the real responses, including the errors.

```bash
curl -s https://griha.vercel.app/api/mcp \
  -H 'content-type: application/json' \
  -H 'x-griha-token: <board token from /settings>' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"compute_fairness",
                 "arguments":{"boardToken":"<board token>","refreshContext":false}}}'
```

The published descriptor is [`public/mcp.json`](./public/mcp.json).

---

## 🔐 Integrity and auditability

```
seal_n = SHA-384( UTF-8(prevSeal) || canonicalJson(event_n) )
```

`canonicalJson` sorts object keys recursively, so the bytes do not depend on property
order — without that, re-serialising an event would change its seal and replay would
report tampering that never happened.

The chain is per household, so one busy household cannot invalidate another's
history, and a household can be exported and verified on its own. Order comes from the
stored `seq`, never from a timestamp: a batched write stamps every event in the batch
with one instant, and re-deriving order from the clock would shuffle links that were
sealed in a different order.

Deletion is **soft**. The row survives as a tombstone so the chain stays replayable —
otherwise "the record was altered" and "the record was removed" would be
indistinguishable, which is the exact thing the chain exists to detect.

Replay reports the *first* broken link, because "something is wrong" is not
actionable and "event 7 of 42 was altered" is. The two failure modes are reported
differently, because they mean different things:

```mermaid
graph TB
  Write["A write"] --> Service["service.ts"]
  Service --> Row["INSERT the row"]
  Service --> Seal["seal = SHA-384(prevSeal + canonicalJson)"]
  Seal --> Chain["Append to the chain"]
  Write --> Audit["Append audit event"]
  Chain --> Chain
  Audit --> Chain

  Chain --> Replay["replayAllChains()"]
  Replay -->|all links hold| Ok["ok · headSeal"]:::emerald
  Replay -->|prevSeal differs| Removed["an event was removed<br/>or reordered"]:::rose
  Replay -->|seal differs| Rewritten["an event was altered<br/>after it was written"]:::rose

  Delete["Delete"] --> Tombstone["Soft delete:<br/>row kept, read returns 404"]:::slate
  Tombstone --> Chain

  classDef emerald fill:#34d399,color:#012b1e,stroke:#059669
  classDef rose fill:#fb7185,color:#2b0710,stroke:#e11d48
  classDef slate fill:#94a3b8,color:#0b1220,stroke:#475569
```

`/verify` replays in the browser. `scripts/verify-live.mjs` replays it over HTTP
against a deployed instance.

---

## 📡 API

Every response uses one envelope, so a client never has to guess whether `error` is a
string or an object.

```jsonc
{ "ok": true,  "data": { }, "meta": { "seal": "…", "engineVersion": "…" } }
{ "ok": false, "error": { "code": "invalid_input", "message": "…", "field": "dueOn" } }
```

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Which adapter is live, and whether it is durable |
| `GET` | `/api/chores` | The board with members and completions |
| `POST` | `/api/chores` | Create a chore (`idempotencyKey` honoured) |
| `GET` `PATCH` `DELETE` | `/api/chores/:id` | Read, update, soft-delete |
| `POST` | `/api/chores/:id/complete` | Record a completion |
| `GET` | `/api/fairness` | Run the engine (`?refresh=false` reuses a sealed context) |
| `GET` | `/api/context` | Normalised forecast and holidays with provenance |
| `GET` `PATCH` | `/api/household` | Read and update the household |
| `GET` `POST` `PATCH` | `/api/members` | Roster and capacity weights |
| `GET` | `/api/export?format=ics\|csv\|md\|json` | A real downloadable file |
| `GET` | `/api/verify` | Replay the audit chain |
| `POST` `GET` | `/api/mcp` | MCP JSON-RPC 2.0 |

A mutation followed by a read-back:

```bash
BASE=https://griha.vercel.app

# 1. mint a session (this is what the board does on first visit)
curl -s -c jar.txt -b jar.txt "$BASE/api/bootstrap?next=/board" -o /dev/null

# 2. create
curl -s -b jar.txt -X POST "$BASE/api/chores" \
  -H 'content-type: application/json' \
  -d '{"title":"Descale the kettle","category":"kitchen",
       "effortMinutes":12,"dueOn":"2026-10-06","outdoor":false}'

# 3. read it back
curl -s -b jar.txt "$BASE/api/chores" | head -c 400

# 4. claim it, then run the engine
curl -s -b jar.txt -X PATCH "$BASE/api/chores/<id>" \
  -H 'content-type: application/json' -d '{"assigneeId":"<memberId>","status":"claimed"}'
curl -s -b jar.txt "$BASE/api/fairness?refresh=false"

# 5. verify the chain, then delete
curl -s -b jar.txt "$BASE/api/verify"
curl -s -b jar.txt -X DELETE "$BASE/api/chores/<id>"
```

Validation is real: `{"dueOn":"not-a-date"}` returns `400` with
`error.field = "dueOn"` and a message naming the problem.

---

## 📁 Project map

### Pages

| Route | Purpose |
| --- | --- |
| `/` | Landing. The hero is the live fair-share bar from a real household, not a slogan. |
| `/board` | The workspace. Claim, complete, delete, filter. Filter and member live in the URL. |
| `/chore/[id]` | Dynamic detail: due date, assignee, weather fit, sealed history for that chore. |
| `/fairness` | The analysis route. Household score, per-member breakdown, outdoor suitability, TabPFN panel. |
| `/agent` | Live MCP console: one-click calls, real requests, real responses. |
| `/export` | Real downloads and the read-only share link with a QR code. |
| `/install` | Cross-platform install guide and scannable QR. |
| `/settings` | Household, city and country, members and capacity weights, the two tokens. |
| `/verify` | Chain replay, with the first broken link named. |
| `/share/[token]` | Public read-only board. No session, no mutating controls. |
| `/offline` | Served by the service worker when the network is gone. |

### API

`/api/health` · `/api/chores` · `/api/chores/[id]` ·
`/api/chores/[id]/complete` · `/api/fairness` · `/api/context` ·
`/api/household` · `/api/members` · `/api/export` · `/api/verify` ·
`/api/mcp` · `/api/bootstrap`

### Libraries

| File | Responsibility |
| --- | --- |
| `src/lib/engine.ts` | The fairness engine. Pure, versioned, no clock, no randomness. |
| `src/lib/integrity.ts` | Canonical JSON, SHA-384 sealing, chain replay. |
| `src/lib/repository.ts` | Schema, indexes, transactions, the two adapters. |
| `src/lib/service.ts` | The only write path. Seeding, reads, engine invocation. |
| `src/lib/validation.ts` | Every boundary check. Lengths, enums, formats, bounds. |
| `src/lib/session.ts` | Anonymous session, rate limiting, secure-cookie detection. |
| `src/lib/context.ts` | The two public feeds, normalised, timed out, cached, fallbacks. |
| `src/lib/ml/features.ts` | Builds TabPFN's training table from real history. Pure and tested. |
| `src/lib/errors.ts` | The response envelope and the error taxonomy. |

### Tests

`tests/engine.test.ts` · `tests/integrity.test.ts` · `tests/repository.test.ts` ·
`tests/validation.test.ts` · `tests/features.test.ts` · `e2e/journey.spec.ts`

109 unit and integration tests, including boundary and degenerate cases for the
engine, tamper detection for the chain, and full CRUD against a real Postgres
(PGlite is Postgres compiled to WASM, not a mock).

---

## 🔒 Security model

**There are no accounts.** A household is owned by an anonymous browser session and
nothing else. That removes credential theft entirely, and in exchange it means every
write is anonymous, so the interesting attacks are cross-site writes, guessing an
ownership scope, reading another household's data, and driving somebody else's board
through MCP.

| Concern | What Griha does |
| --- | --- |
| Cross-site write | 192-bit id in an `HttpOnly`, `SameSite=Lax` cookie; `Secure` derived from the request protocol, not `NODE_ENV` |
| Cross-household reads | Every query filtered by `household_id`; a foreign id returns 404 |
| Leaking a shared link | Two separate tokens. The share token reads a board; the board token writes it |
| MCP as an ambient-authority footgun | Requires an explicit credential; no cookie fallback |
| Injection | Parameterised queries; length-, type- and enum-bounded input; `DATABASE_SCHEMA` pattern-validated before interpolation |
| Error leakage | Unknown failures collapse to a generic 500; driver messages never reach the client |
| Removal vs alteration | Soft delete, so replay can still tell the difference |

**Stated plainly:** the anonymous write throttle is best-effort and per-process,
because serverless instances do not share memory. It bounds traffic landing on one
warm instance and is not a security boundary. A deployment needing a hard limit
should put a hosted rate limiter in front of `/api/*`. Board tokens cannot be
rotated yet — that is the first thing on the roadmap.

Full detail in [`SECURITY.md`](./SECURITY.md).

---

## 📱 Cross-platform install

Griha is an installable **progressive web app**: an app icon on the home screen or
taskbar, its own window, an offline shell, and automatic updates on deploy.

| Platform | How |
| --- | --- |
| Android | Chrome or Edge → menu → Install app |
| iPhone / iPad | Safari → Share → Add to Home Screen |
| Windows | Chrome or Edge → install icon in the address bar |
| macOS | Safari → File → Add to Dock |
| Linux | Any Chromium browser → install control |
| Any browser | Nothing to install; bookmark it |

The install page shows a QR code of itself. Point a phone at it and you are on your
phone. `GRIHA` also says the quiet part out loud: it is a PWA, not a native binary,
so it is not in the App Store or Play Store, it cannot be listed as a
background-enabled app, and it needs no signing certificate or store fee.

---

## 🗺️ Roadmap

### Now — shipped

- Deterministic fairness engine with itemised, weighted factors
- SHA-384 audit chain with replay and tombstones
- Eleven MCP tools sharing the UI's write path
- TabPFN v2 fitted on-device, with honest failure states
- Four real export formats and a read-only share route
- Installable PWA with offline shell and QR

```mermaid
graph LR
  A["Deterministic<br/>engine"]:::done --> B["Sealed<br/>audit chain"]:::done
  B --> C["11 MCP<br/>tools"]:::done
  C --> D["On-device<br/>TabPFN"]:::done
  D --> E["Installable<br/>PWA"]:::done

  classDef done fill:#34d399,color:#012b1e,stroke:#059669
```

### Next — the things a real household would ask for

- **Rotate a board token** from Settings, with the old one revoked immediately.
  Right now tokens cannot be changed at all, and that is the most likely thing a
  real deployment needs first.
- **Named households with invitations**, so a family can be one ledger instead of
  one ledger per browser. Today a second device means opening the read-only link.
- **Recurring chores** with cadence, so "the filter" reappears on a schedule rather
  than needing to be retyped when someone notices.
- **Offline writes with replay.** The shell already works offline; the missing half
  is queueing a completion made on a train and sealing it on reconnect.
- **Household-aware rate limiting** using a hosted store, replacing the
  best-effort per-process throttle.
- **Self-hosted TabPFN weights**, so the model loads from your own origin.

```mermaid
graph LR
  N1["Rotate board<br/>token"]:::next --> N2["Named households<br/>+ invitations"]:::next
  N2 --> N3["Recurring<br/>chores"]:::next
  N3 --> N4["Offline writes<br/>+ replay"]:::next
  N4 --> N5["Hosted rate<br/>limiting"]:::next
  N5 --> N6["Self-hosted<br/>weights"]:::next

  classDef next fill:#a78bfa,color:#1b1039,stroke:#7c3aed
```

### Later — only if the above holds up

- **Photo proof on a completion.** A timestamp is an assertion; a photo is evidence.
  Useful for repairs and for anything a landlord might ask about.
- **Cost tracking per chore**, split across the household, so "the household spent
  this much on cleaning" is a fact rather than a guess.
- **Export to a shared calendar with per-member filters**, for households that already
  live in their calendar.
- **A native shell.** Only worth it if something appears that a PWA genuinely cannot
  do — background sync and push are the honest candidates. Until then one codebase is
  worth more than four.

```mermaid
graph LR
  L1["Photo proof"]:::later --> L2["Cost tracking"]:::later
  L2 --> L3["Calendar with<br/>per-member filters"]:::later
  L3 --> L4["Native shell<br/>if justified"]:::later

  classDef later fill:#94a3b8,color:#0b1220,stroke:#475569
```

---

## 📄 Data and attribution

| Source | Used for | Terms |
| --- | --- | --- |
| [Open-Meteo](https://open-meteo.com/) | Seven-day forecast, scoring outdoor chores | Free, key-free public API |
| [Nager.Date](https://date.nager.at/) | Public holidays for the household's country | Free, key-free public API |
| [TabPFN v2](https://github.com/PriorLabs/TabPFN) (Prior Labs) | In-browser completion-likelihood model | Weights under the Prior Labs licence; WebTabPFN runtime is Apache-2.0 |

Model weights are downloaded at runtime and cached by the browser; Griha does not
redistribute them.

## ⚠️ Scope

Griha is not a medical, legal or safety system. It does not track health, location or
finances, and it should not be relied on where a wrong answer could hurt someone.

---

## 🤝 Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). The short version: a score without
arithmetic is not finished, every write goes through `service.ts`, and if a feed
falls back then the UI has to say so.

MIT © [aniruddhaadak80](https://github.com/aniruddhaadak80)