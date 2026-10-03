import { fail } from "@/lib/errors";
import { getRepository } from "@/lib/repository";
import { peekSessionId } from "@/lib/session";
import { computeHouseholdFairness, loadBundle } from "@/lib/service";
import { replayChain } from "@/lib/integrity";
import type { Chore, Member } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Household export.
 *
 * Four genuinely different artefacts from one bundle:
 *   - `.ics`  a real RFC 5545 calendar, one VEVENT per open chore, so a phone
 *            can be reminded rather than told;
 *   - `.csv`  spreadsheet-shaped, with a header row and escaped fields;
 *   - `.md`   a digest sized for pasting into a family group chat;
 *   - `.json` the whole state plus the audit chain, for anyone who wants to
 *            replay the seals offline.
 *
 * Each is built with the session's own household. There is no public, unlisted
 * export URL: an export contains every chore and every completion, so it must
 * come from the same anonymous session that owns the board.
 */

/** Escape a value for CSV: quote it and double any embedded quote. */
function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function icsEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/** `YYYYMMDDTHHMMSSZ` — the basic format RFC 5545 requires. */
function icsStamp(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

/**
 * All-day VEVENTs use a VALUE=DATE and a floating date, not a UTC timestamp.
 * Converting an all-day chore to a UTC instant shifts it by a day for anyone
 * east or west of Greenwich, which is the classic bug in chore calendars.
 */
function icsDate(isoDate: string): string {
  return isoDate.replace(/-/g, "");
}

function buildIcs(householdName: string, chores: Chore[], members: Member[], stamp: Date): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//griha//household board//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(householdName)}`,
  ];

  const byId = new Map(members.map((m) => [m.id, m.name]));

  for (const chore of chores) {
    if (chore.status === "done" || chore.status === "skipped") continue;

    const nextDay = new Date(`${chore.dueOn}T00:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const end = icsDate(nextDay.toISOString().slice(0, 10));

    const description = [
      `Effort: ${chore.effortMinutes} min`,
      `Category: ${chore.category}`,
      chore.assigneeId ? `Assigned to: ${byId.get(chore.assigneeId) ?? "unknown"}` : "Unclaimed",
      chore.outdoor ? "Outdoor chore - scored against the forecast" : null,
      chore.note || null,
    ]
      .filter(Boolean)
      .join("\\n");

    lines.push(
      "BEGIN:VEVENT",
      `UID:${chore.id}@griha`,
      `DTSTAMP:${icsStamp(stamp)}`,
      `DTSTART;VALUE=DATE:${icsDate(chore.dueOn)}`,
      `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:${icsEscape(chore.title)}`,
      `DESCRIPTION:${icsEscape(description)}`,
      `CATEGORIES:${icsEscape(chore.category.toUpperCase())}`,
      `STATUS:${chore.status === "claimed" ? "CONFIRMED" : "TENTATIVE"}`,
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  // RFC 5545 requires CRLF line endings.
  return `${lines.join("\r\n")}\r\n`;
}

function buildCsv(chores: Chore[], members: Member[]): string {
  const byId = new Map(members.map((m) => [m.id, m.name]));
  const header = ["id", "title", "category", "status", "effort_minutes", "due_on", "outdoor", "assignee", "note"];
  const rows = chores.map((chore) => [
    chore.id,
    chore.title,
    chore.category,
    chore.status,
    chore.effortMinutes,
    chore.dueOn,
    String(chore.outdoor),
    chore.assigneeId ? (byId.get(chore.assigneeId) ?? "") : "",
    chore.note,
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

function buildMarkdown(args: {
  householdName: string;
  chores: Chore[];
  members: Member[];
  fairnessScore: number;
  spreadPoints: number;
  recommendation: string | null;
  shareUrl: string;
  engineVersion: string;
  fairnessSeal: string;
}): string {
  const { householdName, chores, members, fairnessScore, spreadPoints, recommendation, shareUrl, engineVersion, fairnessSeal } = args;
  const byId = new Map(members.map((m) => [m.id, m.name]));

  const open = chores.filter((c) => c.status !== "done" && c.status !== "skipped");
  const lines: string[] = [];

  lines.push(`# ${householdName} — this week's board`);
  lines.push("");
  lines.push(`Fairness **${fairnessScore.toFixed(1)}** · spread ${spreadPoints} points · ${open.length} open chore(s).`);
  lines.push("");
  lines.push("| Chore | Who | Due | Est. | Notes |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const chore of open) {
    lines.push(
      `| ${chore.title} | ${chore.assigneeId ? (byId.get(chore.assigneeId) ?? "—") : "unclaimed"} | ${chore.dueOn} | ${chore.effortMinutes}m | ${chore.note || "—"} |`,
    );
  }
  lines.push("");
  if (recommendation) {
    lines.push(`**Next up:** ${recommendation}`);
    lines.push("");
  }
  lines.push(`Engine \`${engineVersion}\` · ledger seal \`${fairnessSeal.slice(0, 24)}…\``);
  lines.push("");
  lines.push(`Open the live board: ${shareUrl}`);

  return lines.join("\n");
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const format = (url.searchParams.get("format") ?? "json").toLowerCase();
    const ownerId = await peekSessionId();

    if (!ownerId) {
      return fail(new Error("No session. Open the board first so Griha knows which household to export."));
    }

    const repo = await getRepository();
    const bundle = await loadBundle(repo, ownerId);
    if (!bundle.household) {
      return fail(new Error("No household for this session."));
    }

    const fairness = await computeHouseholdFairness(repo, bundle, new Date(), { fetchContext: false });
    const events = await repo.listAudit(bundle.household.id);
    const slug = bundle.household.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "household";
    const stamp = new Date();

    const base = {
      "Cache-Control": "private, no-store",
    };

    switch (format) {
      case "ics":
        return new Response(buildIcs(bundle.household.name, bundle.chores, bundle.members, stamp), {
          ...base,
          headers: {
            ...base,
            "Content-Type": "text/calendar; charset=utf-8",
            "Content-Disposition": `attachment; filename="${slug}.ics"`,
          },
        });

      case "csv":
        return new Response(buildCsv(bundle.chores, bundle.members), {
          ...base,
          headers: {
            ...base,
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${slug}.csv"`,
          },
        });

      case "md":
      case "markdown": {
        const markdown = buildMarkdown({
          householdName: bundle.household.name,
          chores: bundle.chores,
          members: bundle.members,
          fairnessScore: fairness.fairnessScore,
          spreadPoints: fairness.spreadPoints,
          recommendation: fairness.recommendation?.reason ?? null,
          shareUrl: `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://griha.vercel.app"}/share/${bundle.household.shareToken}`,
          engineVersion: fairness.version,
          fairnessSeal: fairness.seal,
        });
        return new Response(markdown, {
          ...base,
          headers: {
            ...base,
            "Content-Type": "text/markdown; charset=utf-8",
            "Content-Disposition": `attachment; filename="${slug}.md"`,
          },
        });
      }

      case "json":
      default: {
        const chain = replayChain(events);
        const payload = {
          household: bundle.household,
          members: bundle.members,
          chores: bundle.chores,
          completions: bundle.completions,
          fairness,
          audit: {
            algorithm: "seal_n = SHA-384(UTF-8(prevSeal) || canonicalJson(event_n))",
            events: events.map((event) => ({
              id: event.id,
              action: event.action,
              payload: event.payload,
              prevSeal: event.prevSeal,
              seal: event.seal,
              createdAt: event.createdAt,
            })),
            ok: chain.ok,
            headSeal: chain.headSeal,
            firstBrokenAt: chain.firstBrokenAt,
            reason: chain.reason,
          },
          generatedAt: stamp.toISOString(),
        };

        return new Response(JSON.stringify(payload, null, 2), {
          ...base,
          headers: {
            ...base,
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": `attachment; filename="${slug}.json"`,
          },
        });
      }
    }
  } catch (error) {
    return fail(error);
  }
}