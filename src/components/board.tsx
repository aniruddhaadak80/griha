"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Check, CloudRain, Loader2, Plus, Trash2, UserRound } from "lucide-react";
import { apiFetch, ApiError } from "@/components/api-client";
import { BalanceBar } from "@/components/balance-bar";
import type { Chore, FairnessResult, Member } from "@/lib/types";
import { CHORE_CATEGORIES } from "@/lib/types";

interface Props {
  initialChores: Chore[];
  members: Member[];
  fairness: FairnessResult;
  householdName: string;
  shareToken: string;
}

type Filter = "all" | "open" | "claimed" | "done" | "overdue";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "All" },
  { key: "open", label: "Unclaimed" },
  { key: "claimed", label: "Claimed" },
  { key: "overdue", label: "Overdue" },
  { key: "done", label: "Done" },
];

/**
 * The chore board.
 *
 * Filter and the selected member live in the URL, not in component state, so a
 * board can be linked to and survives a refresh — which matters because the
 * whole point of the app is that everyone looks at the same thing.
 *
 * Every button here calls the real API, and every failure is rendered with the
 * server's own message. There is no optimistic update: a claim has to be
 * persisted before the bar moves, because the bar is derived from persisted
 * completions and showing a number that a reload would contradict is exactly the
 * failure mode this product exists to fix.
 */
export function Board({ initialChores, members, fairness: initialFairness, householdName, shareToken }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [chores, setChores] = useState(initialChores);
  const [fairness, setFairness] = useState(initialFairness);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDoneId, setPendingDoneId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [, startTransition] = useTransition();

  const filter = (searchParams.get("filter") as Filter | null) ?? "all";
  const memberParam = searchParams.get("member");

  const today = new Date().toISOString().slice(0, 10);
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  const selectedMemberId = memberParam && memberById.has(memberParam) ? memberParam : null;

  /**
   * The roster the engine scored. The raw `members` prop carries only identity
   * and capacity; shares, deviation and verdicts live on the fairness result, so
   * the detail panel must read from here rather than from the roster.
   */
  const activeMember = selectedMemberId
    ? (fairness.members.find((m) => m.memberId === selectedMemberId) ?? null)
    : null;

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value === null) next.delete(key);
    else next.set(key, value);
    const query = next.toString();
    router.replace(query ? `/board?${query}` : "/board", { scroll: false });
  };

  const visible = useMemo(() => {
    const list = [...chores];
    if (filter === "open") return list.filter((c) => c.status === "open");
    if (filter === "claimed") return list.filter((c) => c.status === "claimed");
    if (filter === "done") return list.filter((c) => c.status === "done");
    if (filter === "overdue") return list.filter((c) => c.dueOn < today && c.status !== "done" && c.status !== "skipped");
    return list;
  }, [chores, filter, today]);

  const weatherByChore = useMemo(
    () => new Map(fairness.weatherFit.map((f) => [f.choreId, f])),
    [fairness.weatherFit],
  );

  /** Re-read the board and the engine after every mutation. */
  async function refresh() {
    const [boardResult, fairnessResult] = await Promise.all([
      apiFetch<{ chores: Chore[] }>("/api/chores"),
      apiFetch<{ fairness: FairnessResult }>("/api/fairness?refresh=false"),
    ]);
    setChores(boardResult.data.chores);
    setFairness(fairnessResult.data.fairness);
  }

  async function act(
    choreId: string,
    label: string,
    run: () => Promise<{ meta: { seal?: string } }>,
  ) {
    setBusyId(choreId);
    setError(null);
    setNotice(null);
    try {
      const result = await run();
      await refresh();
      const seal = result.meta.seal?.slice(0, 12);
      setNotice(`${label}. Recorded${seal ? ` · seal ${seal}…` : ""}.`);
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "That action did not go through. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* --- ledger ------------------------------------------------------- */}
      <section className="tile p-4 sm:p-5" aria-labelledby="ledger-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="ledger-heading" className="font-display text-xl font-semibold">
            Fair-share ledger
          </h2>
          <p className="stamp text-xs text-ink-soft">
            {householdName} · {fairness.windowDays}-day window ·{" "}
            <span className="text-ink-faint">{fairness.version}</span>
          </p>
        </div>

        <div className="mt-4">
          <BalanceBar
            members={fairness.members}
            selectedId={selectedMemberId}
            onSelect={(id) => setParam("member", id)}
          />
        </div>

        {activeMember ? (
          <div className="mt-4 rounded-lg border border-grout bg-plate-sunk p-3">
            <p className="font-display text-base font-semibold">{activeMember.name}</p>
            <p className="stamp mt-1 text-xs text-ink-soft">
              {activeMember.minutesDone} min done · {Math.round(activeMember.shareOfWork * 100)}% of work against a{" "}
              {Math.round(activeMember.shareOfCapacity * 100)}% capacity share ·{" "}
              <strong className={activeMember.deviationPoints < 0 ? "text-verdigris" : activeMember.deviationPoints > 0 ? "text-terracotta" : "text-ink"}>
                {activeMember.deviationPoints > 0 ? "+" : ""}
                {activeMember.deviationPoints} pts
              </strong>{" "}
              · {activeMember.verdict}
            </p>
          </div>
        ) : (
          <p className="mt-3 text-xs text-ink-faint">
            Tap a segment to see that person&apos;s exact share and deviation.
          </p>
        )}

        {fairness.recommendation ? (
          <p className="mt-4 rounded-lg border-2 border-ink bg-saffron-wash p-3 text-sm">
            <span className="tile-label">Engine says next</span>
            <br />
            {fairness.recommendation.reason}
          </p>
        ) : (
          <p className="mt-4 rounded-lg border border-grout bg-plate-sunk p-3 text-sm text-ink-soft">
            Nothing needs doing right now — every chore on the board is claimed or done.
          </p>
        )}
      </section>

      {/* --- controls ----------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter chores">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setParam("filter", item.key === "all" ? null : item.key)}
              aria-pressed={filter === item.key}
              className={`rounded-lg border-2 px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                filter === item.key
                  ? "border-ink bg-ink text-plaster"
                  : "border-grout bg-plate text-ink-soft hover:border-ink hover:text-ink"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          aria-expanded={showForm}
          className="btn btn-primary ml-auto"
        >
          <Plus size={16} aria-hidden="true" />
          Add a chore
        </button>
      </div>

      {/* --- feedback ----------------------------------------------------- */}
      {notice ? (
        <p role="status" className="rounded-lg border-2 border-verdigris/50 bg-verdigris-wash px-3 py-2 text-sm text-verdigris">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="flex items-start gap-2 rounded-lg border-2 border-terracotta/50 bg-terracotta-wash px-3 py-2 text-sm text-terracotta-deep">
          <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}

      {showForm ? (
        <NewChoreForm
          members={members}
          today={today}
          onCancel={() => setShowForm(false)}
          onCreated={async () => {
            setShowForm(false);
            await refresh();
            startTransition(() => router.refresh());
          }}
        />
      ) : null}

      {/* --- list --------------------------------------------------------- */}
      {visible.length === 0 ? (
        <div className="tile p-6 text-center">
          <p className="font-display text-lg font-semibold">Nothing here yet</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">
            {filter === "all"
              ? "This board is empty. Add a chore and it will appear here with its due date and fair-share cost."
              : `No chores match "${FILTERS.find((f) => f.key === filter)?.label ?? filter}". Try another filter.`}
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {visible.map((chore) => {
            const assignee = chore.assigneeId ? memberById.get(chore.assigneeId) : null;
            const overdue = chore.dueOn < today && chore.status !== "done" && chore.status !== "skipped";
            const fit = chore.outdoor ? weatherByChore.get(chore.id) : undefined;
            const busy = busyId === chore.id;

            return (
              <li
                key={chore.id}
                className={`tile flex flex-col gap-3 p-4 ${overdue ? "border-terracotta" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/chore/${chore.id}`}
                      className="font-display text-lg leading-tight font-semibold underline-offset-4 hover:underline"
                    >
                      {chore.title}
                    </Link>
                    <p className="stamp mt-1 text-xs text-ink-soft">
                      {chore.category} · {chore.effortMinutes} min · due {chore.dueOn}
                    </p>
                    {chore.note ? <p className="mt-2 text-sm text-ink-soft">{chore.note}</p> : null}
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-1.5">
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
                    {fit ? (
                      <span
                        className={`stamp flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] ${
                          fit.verdict === "good"
                            ? "border-verdigris/40 bg-verdigris-wash text-verdigris"
                            : fit.verdict === "poor"
                              ? "border-saffron/50 bg-saffron-wash text-saffron"
                              : "border-grout bg-plate-sunk text-ink-soft"
                        }`}
                        title={fit.detail}
                      >
                        <CloudRain size={11} aria-hidden="true" />
                        {fit.suitability.toFixed(2)}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-grout pt-3">
                  <span className="stamp mr-auto text-xs text-ink-soft">
                    {assignee ? (
                      <span className="inline-flex items-center gap-1">
                        <UserRound size={12} aria-hidden="true" />
                        {assignee.name}
                      </span>
                    ) : (
                      "Unclaimed"
                    )}
                  </span>

                  {chore.status !== "done" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (selectedMemberId) {
                          void act(chore.id, `Completed "${chore.title}"`, () =>
                            apiFetch(`/api/chores/${chore.id}/complete`, {
                              method: "POST",
                              json: { memberId: selectedMemberId },
                            }),
                          );
                        } else {
                          // Never fire a request we know will fail validation:
                          // ask who did it first, inline, instead of showing an
                          // error the user has to recover from.
                          setPendingDoneId((current) => (current === chore.id ? null : chore.id));
                          setError(null);
                        }
                      }}
                      className="btn btn-primary !min-h-9 !px-2.5 !text-[13px]"
                    >
                      {busy ? (
                        <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                      ) : (
                        <Check size={14} aria-hidden="true" />
                      )}
                      Mark done
                    </button>
                  ) : null}

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      act(chore.id, `Deleted "${chore.title}"`, () =>
                        apiFetch(`/api/chores/${chore.id}`, { method: "DELETE" }),
                      )
                    }
                    className="btn btn-quiet !min-h-9 !px-2 !text-[13px]"
                    aria-label={`Delete ${chore.title}`}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>

                {pendingDoneId === chore.id && chore.status !== "done" ? (
                  <div className="rounded-lg border-2 border-ink bg-saffron-wash p-2.5">
                    <p className="stamp text-xs font-semibold text-ink">Who did &ldquo;{chore.title}&rdquo;?</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {members.map((member) => (
                        <button
                          key={member.id}
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setPendingDoneId(null);
                            void act(chore.id, `Completed "${chore.title}" for ${member.name}`, () =>
                              apiFetch(`/api/chores/${chore.id}/complete`, {
                                method: "POST",
                                json: { memberId: member.id },
                              }),
                            );
                          }}
                          className="rounded-md border-2 border-ink bg-plate px-2 py-1 text-[12px] font-medium hover:bg-ink hover:text-plaster"
                        >
                          {member.name}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setPendingDoneId(null)}
                        className="rounded-md border border-ink px-2 py-1 text-[12px] text-ink-soft"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}

                {chore.status !== "done" && !selectedMemberId ? (
                  <div className="flex flex-wrap gap-1.5">
                    <span className="stamp self-center text-[11px] text-ink-faint">Claim for:</span>
                    {members.map((member) => (
                      <button
                        key={member.id}
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          act(chore.id, `Claimed "${chore.title}" for ${member.name}`, () =>
                            apiFetch(`/api/chores/${chore.id}`, {
                              method: "PATCH",
                              json: { assigneeId: member.id, status: "claimed" },
                            }),
                          )
                        }
                        className={`rounded-md border px-2 py-1 text-[12px] font-medium ${
                          chore.assigneeId === member.id
                            ? "border-ink bg-ink text-plaster"
                            : "border-grout bg-plate text-ink-soft hover:border-ink hover:text-ink"
                        }`}
                      >
                        {member.name}
                      </button>
                    ))}
                    {chore.assigneeId ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          act(chore.id, `Released "${chore.title}"`, () =>
                            apiFetch(`/api/chores/${chore.id}`, {
                              method: "PATCH",
                              json: { assigneeId: null },
                            }),
                          )
                        }
                        className="rounded-md border border-grout bg-plate px-2 py-1 text-[12px] text-ink-faint hover:border-ink hover:text-ink"
                      >
                        Release
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-ink-faint">
        Showing {visible.length} of {chores.length} chores ·{" "}
        <Link href={`/share/${shareToken}`} className="underline underline-offset-4 hover:text-ink">
          share this board read-only
        </Link>
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function NewChoreForm({
  members,
  today,
  onCancel,
  onCreated,
}: {
  members: Member[];
  today: string;
  onCancel: () => void;
  onCreated: () => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>("kitchen");
  const [effort, setEffort] = useState("20");
  const [dueOn, setDueOn] = useState(today);
  const [outdoor, setOutdoor] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch("/api/chores", {
        method: "POST",
        json: {
          title,
          category,
          effortMinutes: Number(effort),
          dueOn,
          outdoor,
          note,
        },
      });
      await onCreated();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not add that chore.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="tile space-y-3 p-4" aria-label="Add a chore">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className="label">What needs doing</span>
          <input
            className="field mt-1"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Take out the recycling"
            required
            minLength={2}
            maxLength={120}
          />
        </label>

        <label>
          <span className="label">Category</span>
          <select className="field mt-1" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CHORE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="label">Effort (minutes)</span>
          <input
            className="field mt-1"
            type="number"
            min={1}
            max={1440}
            value={effort}
            onChange={(e) => setEffort(e.target.value)}
            required
          />
        </label>

        <label>
          <span className="label">Due on</span>
          <input
            className="field mt-1"
            type="date"
            value={dueOn}
            onChange={(e) => setDueOn(e.target.value)}
            required
          />
        </label>

        <label className="flex items-center gap-2 self-end pb-1">
          <input
            type="checkbox"
            checked={outdoor}
            onChange={(e) => setOutdoor(e.target.checked)}
            className="h-5 w-5 accent-[var(--terracotta)]"
          />
          <span className="text-sm">Outdoors — score against the forecast</span>
        </label>

        <label className="sm:col-span-2">
          <span className="label">Note (optional)</span>
          <input
            className="field mt-1"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Blue bin by the gate"
            maxLength={400}
          />
        </label>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-terracotta-deep">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : null}
          Add to the board
        </button>
        <button type="button" className="btn btn-quiet" onClick={onCancel}>
          Cancel
        </button>
        <p className="stamp self-center text-xs text-ink-faint">{members.length} member(s) in this household.</p>
      </div>
    </form>
  );
}