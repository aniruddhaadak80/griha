"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Trash2 } from "lucide-react";
import { apiFetch, ApiError } from "@/components/api-client";
import type { Chore, Member } from "@/lib/types";

/**
 * Claim, complete, unclaim and delete for one chore.
 *
 * Each control writes through the REST API and then re-reads, so the page never
 * shows a state the server has not accepted. Delete asks for confirmation
 * because it cannot be undone from the UI — the row survives as a tombstone so
 * the audit chain stays replayable, but the chore does not come back.
 */
export function ChoreActions({ chore, members }: { chore: Chore; members: Member[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [, startTransition] = useTransition();

  async function run(label: string, call: () => Promise<{ meta: { seal?: string } }>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await call();
      const seal = result.meta.seal?.slice(0, 12);
      setNotice(`${label}. Recorded${seal ? ` · seal ${seal}…` : ""}.`);
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "That action did not go through.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border-t border-grout pt-4">
      <p className="label">Act on this chore</p>

      {error ? (
        <p role="alert" className="mt-2 rounded-lg border border-terracotta/50 bg-terracotta-wash px-3 py-2 text-sm text-terracotta-deep">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-2 rounded-lg border border-verdigris/40 bg-verdigris-wash px-3 py-2 text-sm text-verdigris">
          {notice}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {chore.status !== "done" ? (
          <div className="flex flex-wrap gap-1.5">
            <span className="stamp self-center text-[11px] text-ink-faint">Complete as:</span>
            {members.map((member) => (
              <button
                key={member.id}
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(`Completed for ${member.name}`, () =>
                    apiFetch(`/api/chores/${chore.id}/complete`, {
                      method: "POST",
                      json: { memberId: member.id },
                    }),
                  )
                }
                className="rounded-md border-2 border-ink bg-plate px-2.5 py-1.5 text-[13px] font-medium hover:bg-ink hover:text-plaster disabled:opacity-50"
              >
                {busy ? <Loader2 size={12} className="mr-1 inline animate-spin" aria-hidden="true" /> : null}
                {member.name}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-verdigris">Marked done. Re-open it below if that was a mistake.</p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {chore.status === "done" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run("Re-opened", () => apiFetch(`/api/chores/${chore.id}`, { method: "PATCH", json: { status: "open" } }))}
            className="btn btn-secondary !min-h-9 !px-3 !text-[13px]"
          >
            Re-open
          </button>
        ) : null}

        {chore.assigneeId ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run("Released", () => apiFetch(`/api/chores/${chore.id}`, { method: "PATCH", json: { assigneeId: null } }))}
            className="btn btn-quiet !min-h-9 !px-3 !text-[13px]"
          >
            Release the claim
          </button>
        ) : null}

        {confirmingDelete ? (
          <span className="flex items-center gap-2 rounded-lg border-2 border-terracotta bg-terracotta-wash px-2.5 py-1.5">
            <span className="text-[13px] text-terracotta-deep">Delete for good?</span>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await apiFetch(`/api/chores/${chore.id}`, { method: "DELETE" });
                  router.push("/board");
                  router.refresh();
                } catch (caught) {
                  setError(caught instanceof ApiError ? caught.message : "Delete did not go through.");
                  setBusy(false);
                }
              }}
              className="rounded-md border-2 border-terracotta bg-terracotta px-2 py-1 text-[12px] font-semibold text-white"
            >
              <Trash2 size={12} className="mr-1 inline" aria-hidden="true" />
              Yes, delete
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="rounded-md border border-ink px-2 py-1 text-[12px]"
            >
              Keep it
            </button>
          </span>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirmingDelete(true)}
            className="btn btn-quiet !min-h-9 !px-3 !text-[13px]"
          >
            <Trash2 size={14} aria-hidden="true" />
            Delete
          </button>
        )}
      </div>

      <p className="mt-3 flex items-start gap-1.5 text-[11px] text-ink-faint">
        <Check size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
        Deleting keeps a tombstone so the SHA-384 chain stays replayable — the chore is gone from the board, but the
        record of its removal is permanent.
      </p>
    </div>
  );
}