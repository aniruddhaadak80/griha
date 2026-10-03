# Contributing to Griha

Thanks for looking. This is a small project with a narrow idea, so the most
useful contributions tend to be corrections, edge cases and accessibility work
rather than new features.

## Getting it running

```bash
git clone https://github.com/aniruddhaadak80/griha
cd griha
npm install
npm run dev
```

No configuration, no API keys, no database. With no environment variables the
app runs an embedded Postgres in the same process, so the board, the fairness
report, the agent console and every export work immediately.

Open <http://localhost:3000>. The first visit mints a session cookie and seeds a
starter board so you are not staring at an empty page.

## The checks your change has to pass

```bash
npm run typecheck   # tsc --noEmit, strict
npm run lint        # eslint, zero warnings tolerated
npm run test        # vitest: engine, integrity chain, validation, repository
npm run build       # production build
npm run e2e         # Playwright journey, desktop and mobile
```

`npm run e2e` expects a server on port 3000. To run it against a production
bundle:

```bash
npm run build
ALLOW_EMBEDDED_DB=1 npm start -- --port 3000
GRIHA_BASE_URL=http://127.0.0.1:3000 npm run e2e
```

## What we care about

**A score without arithmetic is not finished.** Every number the product shows
must be reproducible from something a reader can inspect. If you touch
`src/lib/engine.ts`, add the test that proves the new factor behaves at its
boundaries, and expect the UI to show the derivation.

**One mutation path.** Writes go through `src/lib/service.ts`, which the board
buttons, the REST routes and the MCP tools all share. Please do not add a
`fetch` that writes. If a new entry point needs to mutate something, add a
service function and call that.

**Every change is sealed.** Any new write must append an audit event through the
same chain. The seal format is load-bearing:

```
seal_n = SHA-384( UTF-8(prevSeal) || canonicalJson(event_n) )
```

`canonicalJson` sorts object keys recursively so the bytes do not depend on
property order. Changing it invalidates every historical seal, so treat it as a
breaking change and say so in the pull request.

**Honesty over polish.** If a feed falls back to the sealed sample, say so. If
the TabPFN model cannot load, show the error. If a number is an estimate, label
it. A control that cannot work should be removed rather than stubbed.

## Things that are deliberately not welcome

- Adding an API key requirement to the core experience.
- Introducing a server-side LLM call. The fairness engine is deterministic on
  purpose: it must give the same answer for the same ledger on every machine, and
  the TabPFN layer is the part that is allowed to be approximate — in the user's
  browser, not on a server.
- A client-side rewrite of the engine maths.
- Hand-edited SQL outside `src/lib/repository.ts`.

## Reporting a bug

Include what you did, what you expected, and what happened. If it involves the
fairness number, the member capacities and the completions in the window are the
useful part — a household with one member and no completions is very different
from one with four.

## Reporting a security issue

Please do not open a public issue. See [SECURITY.md](./SECURITY.md).

## Licence

MIT. Contributions are accepted under it.