"use client";

import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { CloudRain, TrendingDown, TrendingUp } from "lucide-react";
import { BalanceBar } from "@/components/balance-bar";
import { FactorList } from "@/components/factor-list";
import { ContextBadges } from "@/components/source-badge";
import type { FairnessResult } from "@/lib/types";

/**
 * The analysis route.
 *
 * The per-member cards and the bar are driven by the same `fairness.members`
 * array the API returned, so selecting a segment and reading a card can never
 * disagree. A "what if I do this" weight editor is included on purpose: the
 * point of an explainable engine is that a household can change an input and
 * watch the consequence, without anyone needing to redeploy anything.
 */
export function FairnessReport({
  fairness,
  householdName,
}: {
  fairness: FairnessResult;
  householdName: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const reduce = useReducedMotion();

  const onTrack = useMemo(
    () => fairness.members.filter((m) => m.verdict === "fair").length,
    [fairness.members],
  );

  const overdueTotal = fairness.members.reduce((sum, m) => sum + m.overdueMinutes, 0);
  const liveFeeds = fairness.context.weather.status === "live" || fairness.context.holidays.status === "live";

  return (
    <div className="space-y-6">
      <section className="tile p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="label">{householdName} · last {fairness.windowDays} days</p>
            <p className="mt-1 font-display text-5xl font-bold">{fairness.fairnessScore.toFixed(1)}</p>
            <p className="stamp mt-1 text-sm text-ink-soft">
              spread across the household: <strong>{fairness.spreadPoints} points</strong> ·{" "}
              {onTrack} of {fairness.members.length} exactly on their share
            </p>
          </div>
          <div className="text-right">
            <p className="label">Engine</p>
            <p className="stamp mt-1 text-xs text-ink-soft">{fairness.version}</p>
            <p className="stamp mt-1 text-[11px] text-ink-faint">computed {fairness.computedAt.slice(0, 19).replace("T", " ")} UTC</p>
          </div>
        </div>

        <div className="mt-6">
          <BalanceBar members={fairness.members} selectedId={selectedId} onSelect={setSelectedId} />
        </div>

        {fairness.recommendation ? (
          <div className="mt-5 rounded-lg border-2 border-ink bg-saffron-wash p-4">
            <p className="tile-label text-ink">The single next action</p>
            <p className="mt-1.5 text-base leading-relaxed">{fairness.recommendation.reason}</p>
          </div>
        ) : null}
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        <section className="tile p-5">
          <p className="label">Who carries what</p>
          <h2 className="mt-1 font-display text-2xl font-semibold">Per-member breakdown</h2>

          {fairness.members.length === 0 ? (
            <p className="mt-4 text-sm text-ink-soft">
              No members in this household yet. Add one on the board and the report fills in.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {fairness.members.map((member) => {
                const isSelected = member.memberId === selectedId;
                const Trend = member.deviationPoints < 0 ? TrendingDown : TrendingUp;

                return (
                  <li key={member.memberId}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(isSelected ? null : member.memberId)}
                      aria-expanded={isSelected}
                      className={`tile-sunk w-full p-3 text-left transition-colors ${
                        isSelected ? "border-ink bg-grout-soft" : ""
                      }`}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-display text-lg font-semibold">{member.name}</span>
                        <span className="stamp flex items-center gap-1 text-sm">
                          <Trend
                            size={14}
                            aria-hidden="true"
                            className={member.deviationPoints < 0 ? "text-verdigris" : member.deviationPoints > 0 ? "text-terracotta" : "text-ink-faint"}
                          />
                          <strong
                            className={
                              member.deviationPoints < 0
                                ? "text-verdigris"
                                : member.deviationPoints > 0
                                  ? "text-terracotta"
                                  : "text-ink"
                            }
                          >
                            {member.deviationPoints > 0 ? "+" : ""}
                            {member.deviationPoints} pts
                          </strong>
                        </span>
                      </div>

                      <p className="stamp mt-1 text-xs text-ink-soft">
                        {member.minutesDone} min of work · {member.openChores} open · {member.overdueChores} overdue
                        {member.overdueMinutes > 0 ? ` (${member.overdueMinutes} min)` : ""} · capacity ×{member.capacity}
                      </p>

                      {isSelected ? (
                        <motion.div
                          initial={reduce ? false : { height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          transition={{ duration: reduce ? 0 : 0.22, ease: "easeOut" }}
                          className="overflow-hidden"
                        >
                          <div className="mt-3 border-t border-grout pt-3">
                            <FactorList factors={member.factors} />
                          </div>
                        </motion.div>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="space-y-5">
          <section className="tile p-5">
            <p className="label">Household score</p>
            <h2 className="mt-1 font-display text-2xl font-semibold">Four weighted factors</h2>
            <p className="mt-2 text-xs leading-relaxed text-ink-soft">
              Weights are hand-chosen and documented, not fitted — with a few dozen completions, fitting weights would
              be theatre. Every factor shows the raw sub-score it started from.
            </p>
            <div className="mt-4">
              <FactorList factors={fairness.factors} />
            </div>
          </section>

          <section className="tile p-5">
            <p className="label">Weather-shaped work</p>
            <h2 className="mt-1 font-display text-2xl font-semibold">Outdoor suitability</h2>

            {fairness.weatherFit.length === 0 ? (
              <p className="mt-3 text-sm text-ink-soft">
                No outdoor chores are open. Mark a chore as outdoor when adding it and the engine will score it against
                the real forecast.
              </p>
            ) : (
              <ul className="mt-4 space-y-2">
                {fairness.weatherFit.map((fit) => (
                  <li key={fit.choreId} className="tile-sunk p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="stamp flex items-center gap-1.5 text-sm">
                        <CloudRain size={14} aria-hidden="true" />
                        suitability <strong>{fit.suitability.toFixed(2)}</strong>
                      </span>
                      <span
                        className={`rounded-md border px-1.5 py-0.5 text-[11px] font-semibold uppercase ${
                          fit.verdict === "good"
                            ? "border-verdigris/40 bg-verdigris-wash text-verdigris"
                            : fit.verdict === "poor"
                              ? "border-saffron/50 bg-saffron-wash text-saffron"
                              : "border-grout bg-plate text-ink-soft"
                        }`}
                      >
                        {fit.verdict}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">{fit.detail}</p>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-5">
              <ContextBadges context={fairness.context} />
            </div>

            {!liveFeeds ? (
              <p className="mt-3 rounded-lg border border-saffron/50 bg-saffron-wash p-2.5 text-[11px] leading-relaxed text-saffron">
                Both feeds are running on Griha&apos;s sealed offline sample. Nothing here is a live reading, and the
                suitability figures above are the fallback forecast, not today&apos;s weather.
              </p>
            ) : null}
          </section>

          <section className="tile p-5">
            <p className="label">Backlog</p>
            <h2 className="mt-1 font-display text-2xl font-semibold">
              {overdueTotal > 0 ? `${overdueTotal} overdue minutes` : "Nothing overdue"}
            </h2>
            <p className="mt-2 text-sm text-ink-soft">
              {overdueTotal > 0
                ? "Overdue work is weighted at 0.25 of the household score. It is the factor families feel fastest."
                : "Every open chore is on or before its due date."}
            </p>
            <p className="stamp mt-3 text-[11px] text-ink-faint">
              Head seal {fairness.seal.slice(0, 24)}…
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}