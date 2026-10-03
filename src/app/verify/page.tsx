import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { IntegrityPanel } from "@/components/integrity-panel";
import { getRepository } from "@/lib/repository";
import { peekSessionId } from "@/lib/session";
import { loadBundle } from "@/lib/service";
import { replayChain } from "@/lib/integrity";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Verify the seal chain",
  description:
    "Replay the SHA-384 audit chain for your household. Every event is recomputed from genesis; the panel names the first broken link if one exists.",
  alternates: { canonical: "/verify" },
};

export default async function VerifyPage() {
  const repo = await getRepository();
  const ownerId = await peekSessionId();
  if (!ownerId) redirect("/api/bootstrap?next=/verify");

  const bundle = await loadBundle(repo, ownerId);
  const events = await repo.listAudit(bundle.household.id);
  // Stored sequence order is the chain order; replay must not re-sort by time.
  const replay = replayChain(events);

  return (
    <>
      <PageHeader
        eyebrow="Integrity"
        title="Verify the seal chain"
        lede="Every create, claim, completion and delete is appended to a hash chain. Replaying it recomputes every seal from genesis; if a row was edited or removed after the fact, this page names the exact event where the chain stops agreeing."
      />

      <div className="mx-auto w-full max-w-6xl px-4 py-8">
        <IntegrityPanel replay={replay} events={events} />
      </div>
    </>
  );
}