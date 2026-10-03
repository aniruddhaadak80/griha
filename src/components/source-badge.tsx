import { CloudOff, Cloud } from "lucide-react";
import type { HouseholdContext } from "@/lib/types";

/**
 * Provenance badge.
 *
 * Griha never presents its sealed offline sample as if it were a live reading.
 * Wherever weather or holiday data appears, this badge states which it is, names
 * the upstream source, and shows when it was fetched.
 */
export function SourceBadge({
  status,
  source,
  sourceUrl,
  fetchedAt,
  label,
}: {
  status: "live" | "fallback";
  source: string;
  sourceUrl: string;
  fetchedAt: string;
  label: string;
}) {
  const live = status === "live";
  const Icon = live ? Cloud : CloudOff;

  return (
    <div
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-2.5 py-1.5 text-xs ${
        live ? "border-verdigris/40 bg-verdigris-wash text-verdigris" : "border-saffron/50 bg-saffron-wash text-saffron"
      }`}
    >
      <Icon size={13} aria-hidden="true" />
      <span className="font-semibold">{label}</span>
      <span className="font-semibold">{live ? "live" : "offline sample"}</span>
      <span className="opacity-80">
        {source} ·{" "}
        {sourceUrl ? (
          <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
            source
          </a>
        ) : (
          "no upstream configured"
        )}
      </span>
      <span className="stamp opacity-70">
        fetched {new Date(fetchedAt).toISOString().replace("T", " ").slice(0, 16)} UTC
      </span>
    </div>
  );
}

export function ContextBadges({ context }: { context: HouseholdContext }) {
  return (
    <div className="grid gap-2">
      <SourceBadge
        label="Weather"
        status={context.weather.status}
        source={context.weather.source}
        sourceUrl={context.weather.sourceUrl}
        fetchedAt={context.weather.fetchedAt}
      />
      <SourceBadge
        label="Holidays"
        status={context.holidays.status}
        source={context.holidays.source}
        sourceUrl={context.holidays.sourceUrl}
        fetchedAt={context.holidays.fetchedAt}
      />
    </div>
  );
}