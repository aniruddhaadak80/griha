import { redirect } from "next/navigation";
import { ENGINE_VERSION } from "@/lib/engine";
import { getRepository } from "@/lib/repository";
import { peekSessionId } from "@/lib/session";
import { computeHouseholdFairness, loadBundle } from "@/lib/service";
import { PageHeader } from "@/components/page-header";
import { ExportPanel } from "@/components/export-panel";
import { QrCode } from "@/components/qr-code";
import { site } from "@/config/site";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Export",
  description:
    "Take the board with you: an iCalendar file for phones, CSV for a spreadsheet, Markdown for the family group chat, and JSON with the full audit chain.",
  alternates: { canonical: "/export" },
};

export default async function ExportPage() {
  const repo = await getRepository();
  const ownerId = await peekSessionId();
  if (!ownerId) redirect("/api/bootstrap?next=/export");

  const bundle = await loadBundle(repo, ownerId);
  const fairness = await computeHouseholdFairness(repo, bundle, new Date());
  const events = await repo.listAudit(bundle.household.id);
  const shareUrl = `${site.url}/share/${bundle.household.shareToken}`;

  return (
    <>
      <PageHeader
        eyebrow="Take it with you"
        title="Export the board"
        lede="Everything here is a real file generated from your household right now. The calendar drops straight into a phone, the CSV opens in a spreadsheet, and the Markdown pastes into the family group chat."
      />

      <div className="mx-auto w-full max-w-6xl px-4 py-8">
        <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
          <ExportPanel
            householdName={bundle.household.name}
            choreCount={bundle.chores.length}
            fairnessScore={fairness.fairnessScore}
            auditEvents={events.length}
          />

          <div className="space-y-5">
            <section className="tile p-5">
              <p className="label">Read-only share link</p>
              <h2 className="mt-1 font-display text-xl font-semibold">Anyone, no install</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                This link shows the board to whoever opens it. It cannot claim, complete or delete anything — the share
                token grants strictly less than your board token, and it is the same token an MCP client would need to
                try to change something.
              </p>
              <div className="mt-4 flex flex-col items-center gap-3">
                <QrCode value={shareUrl} size={200} label={shareUrl} />
                <a href={`/share/${bundle.household.shareToken}`} className="stamp text-xs underline underline-offset-4">
                  {shareUrl}
                </a>
              </div>
            </section>

            <section className="tile p-5">
              <p className="label">What is in the JSON</p>
              <ul className="mt-2 space-y-1.5 text-sm text-ink-soft">
                <li>· Household, members and every non-deleted chore</li>
                <li>· Every completion with its recorded minutes</li>
                <li>· The complete fairness result including context provenance</li>
                <li>· The full audit chain: every event, its prevSeal and its seal</li>
              </ul>
              <p className="stamp mt-3 text-[11px] text-ink-faint">
                Algorithm: seal_n = SHA-384(UTF-8(prevSeal) || canonicalJson(event_n)) · engine {ENGINE_VERSION}
              </p>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}