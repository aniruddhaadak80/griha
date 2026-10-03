import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Board } from "@/components/board";
import { getRepository } from "@/lib/repository";
import { peekSessionId } from "@/lib/session";
import { computeHouseholdFairness, loadBundle } from "@/lib/service";
import { site } from "@/config/site";

export const metadata: Metadata = {
  title: "Chore board",
  description:
    "The live shared board. Claim a chore, mark it done, and watch the fair-share ledger rebalance with every real change.",
  alternates: { canonical: "/board" },
};

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const repo = await getRepository();

  // A Server Component can read the session cookie but cannot set one, so a
  // first-time visitor is handed to the bootstrap Route Handler, which mints the
  // cookie and redirects straight back here.
  const ownerId = await peekSessionId();
  if (!ownerId) redirect("/api/bootstrap?next=/board");

  const bundle = await loadBundle(repo, ownerId);
  const fairness = await computeHouseholdFairness(repo, bundle, new Date());

  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title={`${bundle.household.name}'s board`}
        lede={`Every chore, who has it, and what it did to the fair-share split over the last ${fairness.windowDays} days. Filters and the selected member live in the URL, so this exact view can be shared.`}
      />

      <div className="mx-auto w-full max-w-6xl px-4 py-8">
        <Suspense fallback={<BoardSkeleton />}>
          <Board
            initialChores={bundle.chores}
            members={bundle.members}
            fairness={fairness}
            householdName={bundle.household.name}
            shareToken={bundle.household.shareToken}
          />
        </Suspense>

        <p className="mt-8 text-xs text-ink-faint">
          Board state is stored in{" "}
          {repo.kind === "neon-postgres" ? "hosted Postgres" : "an embedded database (local development)"}
          {" · "}
          <a
            href={`${site.repo.url}#project-map`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4"
          >
            see how it is built
          </a>
        </p>
      </div>
    </>
  );
}

function BoardSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-live="polite">
      <span className="sr-only">Loading the board</span>
      <div className="tile h-28 animate-pulse" />
      <div className="grid gap-3 md:grid-cols-2">
        <div className="tile h-40 animate-pulse" />
        <div className="tile h-40 animate-pulse" />
      </div>
    </div>
  );
}