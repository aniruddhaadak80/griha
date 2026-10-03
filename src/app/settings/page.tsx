import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { SettingsPanel } from "@/components/settings-panel";
import { getRepository } from "@/lib/repository";
import { peekSessionId } from "@/lib/session";
import { loadBundle } from "@/lib/service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Settings",
  description: "Rename the household, set the city and country that drive the live feeds, manage members and their capacity weights, and copy the board token the agent tools need.",
  alternates: { canonical: "/settings" },
};

export default async function SettingsPage() {
  const repo = await getRepository();
  const ownerId = await peekSessionId();
  if (!ownerId) redirect("/api/bootstrap?next=/settings");

  const bundle = await loadBundle(repo, ownerId);

  return (
    <>
      <PageHeader
        eyebrow="Configuration"
        title="Household settings"
        lede="The city and country here decide which forecast and which holiday calendar the engine scores against. Capacity weights are what stop the fairness engine treating a night-shift worker and a stay-at-home parent as the same person."
      />

      <div className="mx-auto w-full max-w-6xl px-4 py-8">
        <SettingsPanel
          household={{
            id: bundle.household.id,
            name: bundle.household.name,
            city: bundle.household.city,
            country: bundle.household.country,
            shareToken: bundle.household.shareToken,
            apiToken: bundle.household.apiToken,
          }}
          members={bundle.members}
          persistence={repo.kind}
        />
      </div>
    </>
  );
}