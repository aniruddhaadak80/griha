import type { Factor } from "@/lib/types";

/**
 * Factor breakdown.
 *
 * The point of this component is that a score is never shown without its
 * arithmetic. Each row carries the factor's weight, its raw sub-score, the
 * points it moved, and a sentence describing where those numbers came from.
 */
export function FactorList({ factors, compact = false }: { factors: Factor[]; compact?: boolean }) {
  return (
    <ul className="space-y-2">
      {factors.map((factor) => (
        <li key={factor.key} className="tile-sunk p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="tile-label text-ink">{factor.label}</span>
            <span className="stamp text-xs text-ink-soft">
              weight {factor.weight.toFixed(2)} · raw {factor.raw.toFixed(3)} ·{" "}
              <strong className="text-ink">{factor.contribution.toFixed(2)} pts</strong>
            </span>
          </div>

          {!compact ? (
            <>
              <div
                className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-grout-soft"
                role="presentation"
                aria-hidden="true"
              >
                <div
                  className="h-full rounded-full bg-verdigris"
                  style={{ width: `${Math.round(factor.raw * 100)}%` }}
                />
              </div>
              <p className="mt-2 text-xs leading-relaxed text-ink-soft">{factor.detail}</p>
            </>
          ) : null}
        </li>
      ))}
    </ul>
  );
}