import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, QrCode as QrIcon, Scale, Terminal } from "lucide-react";
import { getRepository } from "@/lib/repository";
import { peekSessionId } from "@/lib/session";
import {
  computeHouseholdFairness,
  DEMO_SCOPE,
  ensureDemoHousehold,
  ensureHousehold,
  loadBundle,
} from "@/lib/service";
import { LiveBalanceBar } from "@/components/live-balance-bar";
import { QrCode } from "@/components/qr-code";
import { GitHubMark } from "@/components/github-mark";
import { ContextBadges } from "@/components/source-badge";
import { site } from "@/config/site";
import { DEFAULT_HOUSEHOLD } from "@/lib/server";

export const metadata: Metadata = {
  title: `${site.name} — ${site.oneLiner}`,
  description: site.description,
  alternates: { canonical: "/" },
};

export const dynamic = "force-dynamic";

/**
 * Landing page.
 *
 * The hero is not a slogan. It is the live board's own fair-share bar, rendered
 * from a real household, so the first thing a visitor sees is the product
 * working rather than a promise that it might. The QR code is on the first
 * screen because "scan this to get it on your phone" is the whole cross-device
 * story.
 */
export default async function LandingPage() {
  const now = new Date();

  let barMembers: Awaited<ReturnType<typeof computeHouseholdFairness>>["members"] = [];
  let fairnessScore = 0;
  let choreCount = 0;
  let context = null as Awaited<ReturnType<typeof computeHouseholdFairness>>["context"] | null;
  let recommendation: Awaited<ReturnType<typeof computeHouseholdFairness>>["recommendation"] = null;
  let householdName = DEFAULT_HOUSEHOLD.name;

  try {
    const repo = await getRepository();
    const session = await peekSessionId();

    // Without a session there is no household to show, and minting a throwaway
    // one per anonymous request would write a new household on every cold cache
    // fill. Instead the hero reads a single shared, read-only demo household,
    // seeded once under a stable scope. A visitor who opens the board gets a
    // real session and a real household of their own.
    const ownerId = session ?? DEMO_SCOPE;
    if (session) await ensureHousehold(repo, session, DEFAULT_HOUSEHOLD, now);
    else await ensureDemoHousehold(repo, now);

    const household = await repo.getHousehold(ownerId);
    if (!household) throw new Error("no household for this scope");

    householdName = session ? household.name : `${household.name} (demo)`;

    const bundle = await loadBundle(repo, ownerId);
    const fairness = await computeHouseholdFairness(repo, bundle, now);
    barMembers = fairness.members;
    fairnessScore = fairness.fairnessScore;
    choreCount = bundle.chores.filter((c) => c.status !== "done" && c.status !== "skipped").length;
    context = fairness.context;
    recommendation = fairness.recommendation;
  } catch {
    // The landing page must render even when the store is unreachable. It says
    // so in the panel rather than pretending the numbers are real.
    barMembers = [];
  }

  return (
    <>
      <section className="border-b border-grout bg-plate/60">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-12 lg:grid-cols-[1.35fr_1fr] lg:py-16">
          <div>
            <p className="label">Household chore ledger</p>
            <h1 className="mt-3 font-display text-4xl leading-[1.05] font-bold sm:text-5xl lg:text-6xl">
              Know who owes what,
              <br />
              <span className="text-terracotta">without the argument.</span>
            </h1>

            <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-soft">
              {site.name} is a shared board for the people you live with. Claim a chore in one tap, and the ledger
              shows the arithmetic behind the split — every share, every deviation, and a SHA-384 seal that proves
              nobody quietly rewrote history.
            </p>

            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/board" className="btn btn-primary">
                Open the board
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <Link href="/install" className="btn btn-secondary">
                <QrIcon size={16} aria-hidden="true" />
                Get it on your phone
              </Link>
              <a
                href={site.repo.url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary"
              >
                <GitHubMark />
                Star on GitHub
              </a>
            </div>

            <ul className="mt-8 grid gap-2 text-sm text-ink-soft sm:grid-cols-2">
              <li className="flex items-start gap-2">
                <Scale size={15} className="mt-0.5 shrink-0 text-verdigris" aria-hidden="true" />
                Deterministic engine — every score shows its arithmetic
              </li>
              <li className="flex items-start gap-2">
                <Terminal size={15} className="mt-0.5 shrink-0 text-verdigris" aria-hidden="true" />
                11 MCP tools, including the same mutating path the buttons use
              </li>
              <li className="flex items-start gap-2">
                <QrIcon size={15} className="mt-0.5 shrink-0 text-verdigris" aria-hidden="true" />
                One installable app for phone, tablet, desktop and browser
              </li>
              <li className="flex items-start gap-2">
                <GitHubMark className="mt-0.5 size-[15px] shrink-0 text-verdigris" />
                MIT licensed, no API keys, nothing to sign up for
              </li>
            </ul>
          </div>

          <aside className="tile flex flex-col gap-4 p-5">
            <div>
              <p className="label">Live right now</p>
              <p className="stamp mt-1 text-sm text-ink-soft">
                {householdName} · {choreCount} open chore{choreCount === 1 ? "" : "s"}
              </p>
            </div>

            <Suspense fallback={<div className="tile-sunk h-11" />}>
              <LiveBalanceBar members={barMembers} />
            </Suspense>

            <div className="flex items-baseline justify-between">
              <span className="label">Household fairness</span>
              <span className="stamp font-display text-3xl font-bold">
                {barMembers.length > 0 ? fairnessScore.toFixed(1) : "—"}
              </span>
            </div>

            {recommendation ? (
              <p className="rounded-lg border border-grout bg-plate-sunk p-3 text-sm leading-relaxed">
                <span className="tile-label text-ink">Next up</span>
                <br />
                {recommendation.reason}
              </p>
            ) : barMembers.length > 0 ? (
              <p className="rounded-lg border border-grout bg-plate-sunk p-3 text-sm text-ink-soft">
                The board is clear. Nothing is waiting on anybody.
              </p>
            ) : (
              <p className="rounded-lg border border-saffron/50 bg-saffron-wash p-3 text-sm text-saffron">
                The household store did not respond, so no live figures are shown here. Open the board to try again.
              </p>
            )}

            {context ? <ContextBadges context={context} /> : null}
          </aside>
        </div>
      </section>

      {/* --- install ------------------------------------------------------- */}
      <section className="mx-auto w-full max-w-6xl px-4 py-12">
        <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="label">One codebase, every device</p>
            <h2 className="mt-2 font-display text-3xl font-bold">
              Scan it, install it, forget the store.
            </h2>
            <p className="mt-4 max-w-2xl leading-relaxed text-ink-soft">
              {site.name} ships as an installable progressive web app. Android and Windows get a real install prompt,
              iOS and macOS get an Add to Home Screen tile, and any browser runs it without installing anything. Same
              URL, same data, no store account, no review queue — and an offline shell that keeps working when the
              network does not.
            </p>
            <Link href="/install" className="btn btn-secondary mt-6">
              Full install guide
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>

          <div className="tile p-5">
            <Suspense fallback={null}>
              <QrCode value={`${site.url}/install`} size={200} label={`${site.url}/install`} />
            </Suspense>
          </div>
        </div>
      </section>

      {/* --- how it works -------------------------------------------------- */}
      <section className="border-t border-grout bg-plate/50">
        <div className="mx-auto w-full max-w-6xl px-4 py-12">
          <p className="label">Three jobs, done properly</p>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {[
              {
                title: "Claim without asking",
                body: "Open the board, tap your name, mark it done. Nobody has to message anyone to find out whether the bins went out.",
              },
              {
                title: "Settle it with numbers",
                body: "The fair-share bar shows each person's actual share against their capacity. Tap a segment for the full arithmetic, weighted and itemised.",
              },
              {
                title: "Prove it later",
                body: "Every change is sealed into a SHA-384 chain. Replay it any time; if a row was edited after the fact, the replay names the exact event.",
              },
            ].map((item) => (
              <article key={item.title} className="tile p-5">
                <h3 className="font-display text-xl font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{item.body}</p>
              </article>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/fairness" className="btn btn-secondary">
              Read the fairness report
            </Link>
            <Link href="/agent" className="btn btn-secondary">
              Try the agent console
            </Link>
            <Link href="/verify" className="btn btn-secondary">
              Verify the seal chain
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}