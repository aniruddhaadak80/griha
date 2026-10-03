import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft, CloudRain, Link2 } from "lucide-react";
import { getRepository } from "@/lib/repository";
import { peekSessionId } from "@/lib/session";
import { computeHouseholdFairness, loadBundle } from "@/lib/service";
import { replayChain, GENESIS_SEAL } from "@/lib/integrity";
import { PageHeader } from "@/components/page-header";
import { FactorList } from "@/components/factor-list";
import { ContextBadges } from "@/components/source-badge";
import { ChoreActions } from "@/components/chore-actions";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/chore/[id]">): Promise<Metadata> {
  const { id } = await params;
  return {
    title: "Chore",
    description: `Chore ${id} in the Griha household ledger, with its audit trail and fair-share cost.`,
  };
}

/**
 * Dynamic chore detail.
 *
 * Three things a shared board needs about a single chore: who has it and when it
 * is due, what it costs the fair-share split, and the sealed history of every
 * change. The last one is what makes a household dispute endable — "I definitely
 * did that last week" resolves in one click.
 */
export default async function ChorePage({ params }: PageProps<"/chore/[id]">) {
  const { id } = await params;

  const repo = await getRepository();
  const ownerId = await peekSessionId();
  if (!ownerId) notFound();

  const bundle = await loadBundle(repo, ownerId);
  const chore = bundle.chores.find((c) => c.id === id);
  if (!chore) notFound();

  const memberById = new Map(bundle.members.map((m) => [m.id, m]));
  const assignee = chore.assigneeId ? memberById.get(chore.assigneeId) : undefined;

  const fairness = await computeHouseholdFairness(repo, bundle, new Date(), { fetchContext: false });
  const fit = fairness.weatherFit.find((f) => f.choreId === chore.id);

  const events = await repo.listAudit(bundle.household.id);
  const chain = replayChain(events);
  const related = events.filter((event) => {
    try {
      const payload = JSON.parse(event.payload) as Record<string, unknown>;
      return payload.choreId === chore.id;
    } catch {
      return false;
    }
  });

  const today = new Date().toISOString().slice(0, 10);
  const overdue = chore.dueOn < today && chore.status !== "done" && chore.status !== "skipped";
  // Typed routes cannot prove a template literal is one of the real routes, so
  // the share path is asserted once here rather than at every call site.
  const shareLink = `/share/${bundle.household.shareToken}` as Route;

  return (
    <>
      <PageHeader
        eyebrow={`${chore.category} · ${chore.effortMinutes} min · due ${chore.dueOn}`}
        title={chore.title}
        lede={chore.note || "No note on this one."}
      >
        <Link href="/board" className="btn btn-secondary">
          <ArrowLeft size={16} aria-hidden="true" />
          Back to the board
        </Link>
        <Link href={shareLink} className="btn btn-secondary">
          <Link2 size={16} aria-hidden="true" />
          Read-only share link
        </Link>
      </PageHeader>

      <div className="mx-auto w-full max-w-6xl px-4 py-8">
        <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
          <div className="space-y-5">
            <section className="tile p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                    overdue
                      ? "border-terracotta/50 bg-terracotta-wash text-terracotta-deep"
                      : chore.status === "done"
                        ? "border-verdigris/40 bg-verdigris-wash text-verdigris"
                        : "border-grout bg-plate-sunk text-ink-soft"
                  }`}
                >
                  {overdue ? "overdue" : chore.status}
                </span>
                {assignee ? (
                  <span className="stamp text-sm text-ink-soft">Assigned to {assignee.name}</span>
                ) : (
                  <span className="stamp text-sm text-ink-soft">Unclaimed</span>
                )}
                {chore.outdoor ? (
                  <span className="stamp flex items-center gap-1 text-sm text-ink-soft">
                    <CloudRain size={13} aria-hidden="true" />
                    outdoors
                  </span>
                ) : null}
              </div>

              <ChoreActions chore={chore} members={bundle.members} />

              {fit ? (
                <p className="mt-4 rounded-lg border border-grout bg-plate-sunk p-3 text-xs leading-relaxed text-ink-soft">
                  <span className="tile-label text-ink">Weather for {chore.dueOn}</span>
                  <br />
                  {fit.detail} — rated <strong>{fit.verdict}</strong>.
                </p>
              ) : null}
            </section>

            <section className="tile p-4">
              <p className="label">Sealed history for this chore</p>
              <p className="stamp mt-1 text-xs text-ink-faint">
                seal_n = SHA-384(UTF-8(prevSeal) || canonicalJson(event_n)) · chain {chain.ok ? "intact" : "BROKEN"}
              </p>

              {related.length === 0 ? (
                <p className="mt-3 text-sm text-ink-soft">No events recorded for this chore yet.</p>
              ) : (
                <ol className="mt-3 space-y-2">
                  {[...related].reverse().map((event) => (
                    <li key={event.id} className="tile-sunk p-2.5">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="tile-label text-ink">{event.action}</span>
                        <span className="stamp text-[11px] text-ink-faint">
                          {event.createdAt.slice(0, 10)}
                        </span>
                      </div>
                      <p className="stamp-seal mt-1">{event.seal}</p>
                    </li>
                  ))}
                </ol>
              )}

              <p className="mt-3 text-[11px] text-ink-faint">
                Chain genesis {GENESIS_SEAL.slice(0, 16)}… · head {chain.headSeal.slice(0, 16)}… ·{" "}
                <Link href="/verify" className="underline underline-offset-4 hover:text-ink">
                  verify the whole chain
                </Link>
              </p>
            </section>
          </div>

          <div className="space-y-5">
            <section className="tile p-4">
              <p className="label">Household factors</p>
              <h2 className="mt-1 font-display text-xl font-semibold">
                Fairness {fairness.fairnessScore.toFixed(1)}
              </h2>
              <p className="stamp mt-1 text-xs text-ink-soft">
                spread {fairness.spreadPoints} points · {fairness.version}
              </p>
              <div className="mt-4">
                <FactorList factors={fairness.factors} />
              </div>
            </section>

            <section className="tile p-4">
              <p className="label">Data provenance</p>
              <div className="mt-3">
                <ContextBadges context={fairness.context} />
              </div>
              <p className="mt-3 text-[11px] text-ink-faint">
                This page reuses the sealed context so it renders instantly. The board and the API fetch live feeds.
              </p>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}