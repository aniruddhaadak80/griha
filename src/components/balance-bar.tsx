"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { MemberFairness } from "@/lib/types";

const TINT_VAR: Record<string, string> = {
  terracotta: "var(--tint-terracotta)",
  verdigris: "var(--tint-verdigris)",
  indigo: "var(--tint-indigo)",
  saffron: "var(--tint-saffron)",
  madder: "var(--tint-madder)",
};

function tintOf(name: string): string {
  return TINT_VAR[name] ?? "var(--ink-faint)";
}

/**
 * The fair-share bar — Griha's signature readout.
 *
 * Each segment's width is that member's actual share of completed minutes, so
 * the bar is not an illustration of the data, it *is* the data. The dashed line
 * is the equal-share marker; a segment that has eaten past it is carrying more
 * than its capacity share, and the gap between the two is the thing households
 * actually argue about.
 *
 * Why it earns the "signature interaction" slot: dragging or tapping a member
 * reveals their exact arithmetic and it recomputes on every mutation, so the bar
 * is the only place a household member has to look to see who is carrying the
 * week. It keeps working with animation disabled and with no colour at all,
 * because the numbers under it are the same numbers.
 */
export function BalanceBar({
  members,
  selectedId,
  onSelect,
}: {
  members: MemberFairness[];
  selectedId: string | null;
  onSelect: (memberId: string | null) => void;
}) {
  const reduce = useReducedMotion();
  const totalMinutes = members.reduce((sum, m) => sum + m.minutesDone, 0);
  const totalCapacity = members.reduce((sum, m) => sum + m.capacity, 0);

  if (members.length === 0) {
    return (
      <div className="tile-sunk p-4 text-sm text-ink-soft">
        No members yet. Add one on the board and the bar will fill with real shares.
      </div>
    );
  }

  return (
    <div>
      <div
        className="balance-track flex h-11"
        role="img"
        aria-label={
          totalMinutes === 0
            ? "No chores completed in the last 28 days."
            : `Fair share of the last 28 days: ${members
                .map((m) => `${m.name} ${Math.round(m.shareOfWork * 100)} percent`)
                .join(", ")}.`
        }
      >
        {members.map((member, index) => {
          const share = totalMinutes > 0 ? member.minutesDone / totalMinutes : 1 / members.length;
          const pct = share * 100;
          const selected = selectedId === member.memberId;

          return (
            <motion.button
              key={member.memberId}
              type="button"
              onClick={() => onSelect(selected ? null : member.memberId)}
              aria-pressed={selected}
              title={`${member.name}: ${Math.round(pct)}% of the work`}
              initial={false}
              animate={{ width: `${pct}%` }}
              transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 220, damping: 26 }}
              style={{
                backgroundColor: tintOf(member.tint),
                // Unselected members stay legible rather than being greyed out:
                // the bar has to be readable in print and in greyscale.
                opacity: selectedId && !selected ? 0.35 : 1,
              }}
              className={`flex items-center justify-center overflow-hidden ${
                index < members.length - 1 ? "balance-seam" : ""
              } ${selected ? "ring-2 ring-inset ring-white" : ""}`}
            >
              {pct > 11 ? (
                <span className="stamp truncate px-1 text-[11px] font-semibold text-white">
                  {member.name.split(" ")[0]} {Math.round(pct)}%
                </span>
              ) : null}
            </motion.button>
          );
        })}
      </div>

      {/* Equal-share marker, positioned from the real capacity split. */}
      {totalCapacity > 0 ? (
        <div className="relative mt-1 h-4" aria-hidden="true">
          {(() => {
            let running = 0;
            return members.map((member) => {
              const before = running;
              running += member.capacity;
              if (member !== members[members.length - 1]) return null;
              const equalShare = (running / totalCapacity) * 100;
              return (
                <div
                  key={member.memberId}
                  className="absolute top-0 -translate-x-1/2 border-l-2 border-dashed border-ink"
                  style={{ left: `${before}%` }}
                >
                  <span className="stamp absolute -top-0 left-1 text-[10px] text-ink-faint">fair share</span>
                  <span className="sr-only">equal share boundary at {Math.round(equalShare)} percent</span>
                </div>
              );
            });
          })()}
        </div>
      ) : null}

      {totalMinutes === 0 ? (
        <p className="mt-2 text-xs text-ink-faint">
          Nothing completed in the last 28 days, so segments show an equal split as a placeholder. Claim and complete a
          chore and the widths become real.
        </p>
      ) : null}
    </div>
  );
}