# Security Policy

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private reporting:

**Security → Report a vulnerability** on
<https://github.com/aniruddhaadak80/griha>

You will normally get an acknowledgement within 72 hours and an assessment within
a week. Fixes for confirmed issues are released as soon as they are ready, and
the advisory credits the reporter unless you would rather stay anonymous.

## Supported versions

| Version | Supported |
| ------- | --------- |
| `main`  | Yes       |

This project has no tagged releases, so `main` is the supported version.

## The threat model in one paragraph

Griha has **no accounts**. A household is owned by an anonymous browser session
and nothing else. That removes credential theft entirely, and in exchange it
means every write is anonymous, so the interesting attacks are cross-site writes,
guessing an ownership scope, reading another household's data, and using the MCP
endpoint to drive somebody else's board. Those are the four things worth
attacking.

## How Griha defends them

**Ownership.** A 192-bit random id in an HTTP-only, `SameSite=Lax` cookie, pinned
to `Secure` when the request arrived over TLS. It is not readable from JavaScript
and is not sent on cross-site requests, which blocks the cheap cross-site write.
`Secure` is derived from the request protocol rather than `NODE_ENV`, so a
production build served over plain HTTP still works.

**Isolation.** Every read and write is filtered by `household_id` in SQL. A chore
id from another household returns `404`, not someone else's data. This is covered
by an integration test.

**Two different tokens.** A share token grants read access to `/share/<token>`.
A board token grants read and write to the MCP endpoint. They are separate
random values, so leaking the link you paste into a family group chat does not
hand over the ability to change the board. Treat the board token like a
password.

**Why MCP requires a token.** An MCP client is an external program. If the
endpoint trusted an ambient cookie, any page in any browser could drive a
household's ledger through whoever happened to be logged in. It requires an
explicit credential instead.

**Input.** Every value crossing the network boundary is length-bounded, type-
checked and enum-checked in `src/lib/validation.ts` before it reaches the
repository. All queries are parameterised. The `DATABASE_SCHEMA` value is
interpolated into DDL and is validated against `^[a-z_][a-z0-9_]{0,62}$`
first.

**Errors.** Unknown failures collapse to a generic 500. Database and driver
messages can contain table names and connection strings, so they are logged
server-side and never returned.

**Deletion is soft.** A deleted chore leaves a tombstone so the audit chain stays
replayable. Without it, "the record was altered" and "the record was removed"
would be indistinguishable, which is precisely the thing the chain exists to
detect.

## Known limitations, stated plainly

**Anonymous writes are only rate-limited per instance.** The throttle in
`src/lib/session.ts` lives in process memory. On serverless, instances do not
share memory, so it bounds traffic landing on one warm instance and nothing more.
It is best-effort, not a security boundary. A deployment that needs a hard limit
should put a hosted limiter in front of `/api/*`.

**There is no way to rotate a board token.** Tokens are generated with the
household and cannot be changed from the UI. Rotating one currently means
creating a new household. This is on the roadmap and is the most likely thing a
real deployment will need first.

**Share links are bearer tokens.** Anyone with the URL can read that board. They
are 128-bit random and unguessable, but they do not expire and they are not
revocable. They are also excluded from search indexing.

**TabPFN weights are fetched from a CDN at runtime.** The model runs entirely in
the browser and no household data is sent anywhere, but the weights themselves are
downloaded from jsDelivr on first use. Griha displays the Prior Labs attribution
their licence requires. Self-hosting the runtime is a documented option.

## What Griha is not

It is not a medical, legal or safety system. It does not track health, location
or finances, and it should not be used where getting an answer wrong could hurt
someone. The footer says so on every page.