"use client";

import { useState } from "react";
import { ShieldCheck, ShieldAlert, RefreshCw } from "lucide-react";
import { apiFetch } from "@/components/api-client";
import type { ReplayResult } from "@/lib/integrity";
import type { AuditEvent } from "@/lib/types";

/**
 * Integrity panel.
 *
 * The server renders the replay on first paint, and "Re-run" performs a real
 * request to /api/verify so the result is never a cached impression. The two
 * failure modes are reported differently on purpose: a `prevSeal` mismatch means
 * something was removed, a `seal` mismatch means something was rewritten, and
 * they are not the same kind of problem.
 */
export function IntegrityPanel({
  replay: initial,
  events: initialEvents,
}: {
  replay: ReplayResult;
  events: AuditEvent[];
}) {
  const [replay, setReplay] = useState(initial);
  const [events, setEvents] = useState(initialEvents);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rerun() {
    setRunning(true);
    setError(null);
    try {
      const result = await apiFetch<{
        ok: boolean;
        events: number;
        headSeal: string;
        genesis: string;
        firstBrokenAt: number | null;
        firstBrokenId: string | null;
        reason: string | null;
        trail: Array<{ id: string; action: string; seal: string; prevSeal: string; createdAt: string }>;
      }>("/api/verify");

      setReplay({
        ok: result.data.ok,
        checked: result.data.events,
        firstBrokenAt: result.data.firstBrokenAt,
        firstBrokenId: result.data.firstBrokenId,
        headSeal: result.data.headSeal,
        reason: result.data.reason,
      });

      if (result.data.trail.length > 0) {
        setEvents(
          result.data.trail.map((entry) => ({
            id: entry.id,
            householdId: "",
            action: entry.action as AuditEvent["action"],
            payload: "",
            prevSeal: entry.prevSeal,
            seal: entry.seal,
            createdAt: entry.createdAt,
          })),
        );
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not reach the verify endpoint.");
    } finally {
      setRunning(false);
    }
  }

  const last = [...events].reverse().slice(0, 12);

  return (
    <div className="space-y-6">
      <section
        className={`tile p-5 ${replay.ok ? "border-verdigris" : "border-terracotta"}`}
        data-testid="integrity-result"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="label">Replay result</p>
            <p
              className={`mt-1 flex items-center gap-2 font-display text-3xl font-bold ${
                replay.ok ? "text-verdigris" : "text-terracotta"
              }`}
            >
              {replay.ok ? <ShieldCheck size={30} aria-hidden="true" /> : <ShieldAlert size={30} aria-hidden="true" />}
              {replay.ok ? "Chain intact" : "Chain broken"}
            </p>
            <p className="stamp mt-1 text-sm text-ink-soft">
              {replay.checked} event{replay.checked === 1 ? "" : "s"} recomputed from genesis
            </p>
          </div>

          <button type="button" onClick={() => void rerun()} disabled={running} className="btn btn-secondary">
            <RefreshCw size={15} className={running ? "animate-spin" : ""} aria-hidden="true" />
            Re-run replay
          </button>
        </div>

        {!replay.ok ? (
          <div className="mt-4 rounded-lg border-2 border-terracotta/50 bg-terracotta-wash p-3 text-sm">
            <p className="font-semibold text-terracotta-deep">
              First broken link at index {replay.firstBrokenAt ?? "?"}
              {replay.firstBrokenId ? ` · event ${replay.firstBrokenId}` : ""}
            </p>
            <p className="mt-1 text-terracotta-deep">{replay.reason}</p>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="mt-4 rounded-lg border border-saffron/50 bg-saffron-wash p-3 text-sm text-saffron">
            {error}
          </p>
        ) : null}

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <div className="tile-sunk p-3">
            <p className="label">Genesis</p>
            <p className="stamp-seal mt-1">{"0".repeat(96)}</p>
          </div>
          <div className="tile-sunk p-3">
            <p className="label">Head seal</p>
            <p className="stamp-seal mt-1">{replay.headSeal}</p>
          </div>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-ink-soft">
          <code className="stamp">seal_n = SHA-384(UTF-8(prevSeal) || canonicalJson(event_n))</code>, where
          canonical JSON recursively sorts object keys so the byte representation — and therefore the seal — cannot
          depend on property order.
        </p>
      </section>

      <section className="tile p-5">
        <p className="label">Chain tail</p>
        <h2 className="mt-1 font-display text-xl font-semibold">Most recent events</h2>

        {last.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">No events yet. Claim or complete a chore and one appears here.</p>
        ) : (
          <ol className="mt-4 space-y-2">
            {last.map((event, index) => (
              <li key={event.id} className="tile-sunk p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="tile-label text-ink">{event.action}</span>
                  <span className="stamp text-[11px] text-ink-faint">
                    #{events.length - last.length + index} · {event.createdAt.slice(0, 19).replace("T", " ")} UTC
                  </span>
                </div>
                <p className="stamp-seal mt-1.5">seal {event.seal}</p>
                <p className="stamp-seal mt-0.5 text-ink-faint">prev {event.prevSeal}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}