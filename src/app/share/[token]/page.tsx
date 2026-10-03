import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepository } from "@/lib/repository";
import { computeHouseholdFairness, loadBundleByShareToken } from "@/lib/service";
import { StaticBalanceBar } from "@/components/live-balance-bar";
import { ContextBadges } from "@/components/source-badge";
import { GitHubMark } from "@/components/github-mark";
import { site } from "@/config/site";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shared household board",
  description: "A read-only view of a Griha household board. No sign-in, no ability to change anything.",
  // Shared boards are addressed by an unguessable token; indexing them would
  // publish a household's chore list to a search engine.
  robots: { index: false, follow: false },
};

/**
 * Public read-only board.
 *
 * Reachable by share token alone — no session cookie — which is the point: a
 * relative who is not in the household, or who has no app installed, can still
 * see what is happening. There are no mutating controls on this page by design,
 * not by omission.
 */
export default async function SharePage({ params }: PageProps<"/share/[token]">) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) notFound();

  const repo = await getRepository();
  const bundle = await loadBundleByShareToken(repo, token);
  const fairness = await computeHouseholdFairness(repo, bundle, new Date(), { fetchContext: false });
  const byId = new Map(bundle.members.map((m) => [m.id, m]));

  const open = bundle.chores.filter((c) => c.status !== "done" && c.status !== "skipped");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <section className="border-b border-grout bg-plate/60">
        <div className="mx-auto w-full max-w-4xl px-4 py-8">
          <p className="label">Shared read-only board</p>
          <h1 className="mt-2 font-display text-3xl font-bold sm:text-4xl">{bundle.household.name}</h1>
          <p className="mt-3 max-w-2xl leading-relaxed text-ink-soft">
            You are seeing this through a share link. It cannot be changed from here — claiming and completing happen in
            the household owner&apos;s own session.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/install" className="btn btn-secondary !min-h-9 !px-3 !text-[13px]">
              Get your own board
            </Link>
            <a
              href={site.repo.url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary !min-h-9 !px-3 !text-[13px]"
            >
              <GitHubMark />
              {site.repo.linkLabel}
            </a>
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-4xl px-4 py-8">
        <section className="tile p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <p className="label">Fair share · last {fairness.windowDays} days</p>
            <p className="stamp font-display text-3xl font-bold">{fairness.fairnessScore.toFixed(1)}</p>
          </div>
          <div className="mt-4">
            <StaticBalanceBar members={fairness.members} />
          </div>
        </section>

        <section className="mt-5">
          <h2 className="font-display text-2xl font-semibold">
            {open.length} open chore{open.length === 1 ? "" : "s"}
          </h2>

          {open.length === 0 ? (
            <p className="tile mt-3 p-5 text-sm text-ink-soft">Nothing outstanding. Enjoy the quiet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {open.map((chore) => {
                const assignee = chore.assigneeId ? byId.get(chore.assigneeId) : undefined;
                const overdue = chore.dueOn < today;
                return (
                  <li key={chore.id} className="tile flex flex-wrap items-baseline justify-between gap-2 p-3">
                    <span className="font-semibold">{chore.title}</span>
                    <span className="stamp text-xs text-ink-soft">
                      {assignee ? assignee.name : "unclaimed"} · {chore.effortMinutes}m ·{" "}
                      <span className={overdue ? "text-terracotta-deep" : ""}>{chore.dueOn}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="mt-5">
          <p className="label">Data provenance</p>
          <div className="mt-2">
            <ContextBadges context={fairness.context} />
          </div>
        </section>
      </div>
    </>
  );
}