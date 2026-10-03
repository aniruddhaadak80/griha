import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { FairnessReport } from "@/components/fairness-report";
import { TabPfnPanel } from "@/components/tabpfn-panel";
import { getRepository } from "@/lib/repository";
import { peekSessionId } from "@/lib/session";
import { computeHouseholdFairness, loadBundle } from "@/lib/service";

export const metadata: Metadata = {
  title: "Fairness report",
  description:
    "The full deterministic fairness report: household score, per-member deviation, every weighted factor with its arithmetic, TabPFN completion odds computed in your browser, and the engine's single recommended next action.",
  alternates: { canonical: "/fairness" },
};

export const dynamic = "force-dynamic";

export default async function FairnessPage() {
  const repo = await getRepository();
  const ownerId = await peekSessionId();
  if (!ownerId) redirect("/api/bootstrap?next=/fairness");

  const bundle = await loadBundle(repo, ownerId);
  const fairness = await computeHouseholdFairness(repo, bundle, new Date());

  return (
    <>
      <PageHeader
        eyebrow="Analysis"
        title="The fairness report"
        lede="No score appears here without its arithmetic. Every factor carries its weight, its raw sub-score and the sentence that produced it, so you can argue with the method instead of the number."
      />

      <div className="mx-auto w-full max-w-6xl px-4 py-8">
        <FairnessReport fairness={fairness} householdName={bundle.household.name} />

        <div className="mt-6">
          <TabPfnPanel
            members={bundle.members}
            chores={bundle.chores}
            completions={bundle.completions}
            context={fairness.context}
            today={new Date().toISOString().slice(0, 10)}
          />
        </div>
      </div>
    </>
  );
}