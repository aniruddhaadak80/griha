"use client";

import { Download, FileJson, FileSpreadsheet, FileText, Calendar } from "lucide-react";
import { site } from "@/config/site";

const FORMATS = [
  {
    id: "ics",
    label: "Calendar (.ics)",
    icon: Calendar,
    blurb:
      "One timed event per chore so it lands in a phone's calendar with a reminder. The most useful export for a shared home.",
    type: "text/calendar",
  },
  {
    id: "csv",
    label: "Spreadsheet (.csv)",
    icon: FileSpreadsheet,
    blurb: "One row per chore with assignee, status, effort and due date. Opens in Excel, Numbers or Sheets.",
    type: "text/csv",
  },
  {
    id: "md",
    label: "Group chat (.md)",
    icon: FileText,
    blurb: "A plain Markdown digest sized for pasting into WhatsApp or a family Telegram, including the fairness summary.",
    type: "text/markdown",
  },
  {
    id: "json",
    label: "Everything (.json)",
    icon: FileJson,
    blurb: "Full household, completions, fairness result and the complete audit chain with every seal.",
    type: "application/json",
  },
];

/**
 * Export centre.
 *
 * These are plain anchor links to real endpoints, not buttons that fake a
 * download with a client-side Blob. That matters: the bytes the browser saves
 * are produced by the same server that owns the data, so an export can never
 * drift from what the board actually holds.
 */
export function ExportPanel({
  householdName,
  choreCount,
  fairnessScore,
  auditEvents,
}: {
  householdName: string;
  choreCount: number;
  fairnessScore: number;
  auditEvents: number;
}) {
  return (
    <section className="tile p-5">
      <p className="label">{householdName}</p>
      <h2 className="mt-1 font-display text-xl font-semibold">
        {choreCount} chore{choreCount === 1 ? "" : "s"} · fairness {fairnessScore.toFixed(1)} · {auditEvents} sealed
        event{auditEvents === 1 ? "" : "s"}
      </h2>

      <ul className="mt-4 space-y-3">
        {FORMATS.map((format) => {
          const Icon = format.icon;
          return (
            <li key={format.id} className="tile-sunk p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <Icon size={15} className="shrink-0 text-verdigris" aria-hidden="true" />
                    {format.label}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-soft">{format.blurb}</p>
                </div>
                <a
                  href={`/api/export?format=${format.id}`}
                  download
                  data-testid={`export-${format.id}`}
                  className="btn btn-secondary !min-h-9 shrink-0 !px-3 !text-[13px]"
                >
                  <Download size={14} aria-hidden="true" />
                  Download
                </a>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-4 text-[11px] leading-relaxed text-ink-faint">
        Exports are generated per session, so they contain only your household. Nothing is cached publicly, and the
        endpoints require the same anonymous session cookie as the rest of the board.
      </p>
    </section>
  );
}

export function ExportFooterNote() {
  return <p className="stamp text-xs text-ink-faint">Generated live from {site.url}</p>;
}