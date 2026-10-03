"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Cpu, Loader2, Play, ShieldCheck, TriangleAlert } from "lucide-react";
import { bandFor, buildPredictionTargets, buildTrainingTable, TABPFN_FEATURES } from "@/lib/ml/features";
import type {
  Chore,
  Completion,
  HouseholdContext,
  Member,
  TabPfnPrediction,
  TabPfnStatus,
} from "@/lib/types";
import { site } from "@/config/site";

/**
 * TabPFN, running entirely in this browser tab.
 *
 * Why this is the "open AI at the core" and not a decoration:
 *
 *   - the weights are Prior Labs' open TabPFN v2, loaded as a quantised ONNX
 *     model and executed by WebTabPFN through WebGPU or WASM;
 *   - `fit()` is called on this household's own completion history, so the model
 *     genuinely learns *their* pattern rather than a global prior;
 *   - nothing is uploaded. The rows, the features and the probabilities stay in
 *     the tab, and the app keeps working with no server involvement at all.
 *
 * The honesty rules this component enforces:
 *   - if the model cannot load, the panel says so with the real error and the
 *     deterministic engine's recommendation stands on its own;
 *   - if there is not enough history, it refuses to predict rather than
 *     predicting noise;
 *   - every probability is labelled with its band and the number of training
 *     rows that produced it.
 */

const SCRIPT_SRC = "https://cdn.jsdelivr.net/npm/webtabpfn@0.2.0/src/webtabpfn.js";

interface WebTabPFNShape {
  load(options: {
    task: "classification" | "regression";
    backend: "webgpu" | "wasm";
    precision: "int4" | "int8";
    cache?: boolean;
  }): Promise<{
    /** Fit is tabular: a row-major matrix plus a label column. */
    fit(x: number[][], y: number[]): Promise<void>;
    predictProba(x: number[][]): Promise<Array<Record<string, number>>>;
    dispose(): Promise<void> | void;
  }>;
  hasWebGpu?(): Promise<boolean>;
}

let scriptPromise: Promise<WebTabPFNShape | null> | null = null;

/** Load the runtime once per page, and only when the user asks for it. */
function loadTabPfnRuntime(): Promise<WebTabPFNShape | null> {
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(null);

    const existing = (window as unknown as { WebTabPFN?: WebTabPFNShape }).WebTabPFN;
    if (existing) return resolve(existing);

    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () =>
      resolve((window as unknown as { WebTabPFN?: WebTabPFNShape }).WebTabPFN ?? null);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });

  return scriptPromise;
}

const IDLE_STATUS: TabPfnStatus = {
  backend: "unavailable",
  precision: null,
  ready: false,
  error: null,
  trainingRows: 0,
  modelName: "TabPFN v2",
  attribution: site.tabpfnAttribution,
};

export function TabPfnPanel({
  members,
  chores,
  completions,
  context,
  today,
}: {
  members: Member[];
  chores: Chore[];
  completions: Completion[];
  context: HouseholdContext;
  today: string;
}) {
  const [status, setStatus] = useState<TabPfnStatus>(IDLE_STATUS);
  const [predictions, setPredictions] = useState<TabPfnPrediction[]>([]);
  const [evidence, setEvidence] = useState<{ completed: number; missed: number }>({ completed: 0, missed: 0 });
  const [running, setRunning] = useState(false);
  const estimatorRef = useRef<Awaited<ReturnType<WebTabPFNShape["load"]>> | null>(null);

  useEffect(() => {
    return () => {
      // Release the ONNX session when the panel unmounts; a tab that opened the
      // panel twenty times should not hold twenty sessions in memory.
      void estimatorRef.current?.dispose?.();
      estimatorRef.current = null;
    };
  }, []);

  const training = buildTrainingTable({ members, chores, completions, context, today });
  const targets = buildPredictionTargets({ members, chores, completions, context, today });

  const run = useCallback(async () => {
    setRunning(true);
    setStatus((prev) => ({ ...prev, error: null }));

    try {
      if (training.length < 6) {
        setStatus({
          ...IDLE_STATUS,
          trainingRows: training.length,
          error: `Only ${training.length} labelled row(s) so far. TabPFN needs at least 6 to say anything meaningful — log a few more completions and this will run.`,
        });
        return;
      }

      const runtime = await loadTabPfnRuntime();
      if (!runtime) {
        setStatus({
          ...IDLE_STATUS,
          trainingRows: training.length,
          error:
            "Could not load the TabPFN runtime from jsDelivr. This can happen offline or behind a strict content blocker. The deterministic engine above is unaffected.",
        });
        return;
      }

      let backend: "webgpu" | "wasm" = "wasm";
      let precision: "int4" | "int8" = "int8";

      try {
        const hasGpu = (await runtime.hasWebGpu?.()) ?? false;
        if (hasGpu) {
          backend = "webgpu";
          precision = "int4";
        }
      } catch {
        // A WebGPU feature check that throws simply means we stay on WASM.
      }

      const estimator = await runtime.load({ task: "classification", backend, precision, cache: true });
      estimatorRef.current = estimator;

      await estimator.fit(
        training.map((row) => row.features),
        training.map((row) => row.label),
      );

      const probabilities = await estimator.predictProba(targets.map((t) => t.features));

      const results: TabPfnPrediction[] = targets.map((target, index) => {
        const row = probabilities[index] ?? {};
        const raw = typeof row["1"] === "number" ? row["1"] : typeof row[1] === "number" ? row[1] : 0;
        const probability = Math.max(0, Math.min(1, raw));
        const band = bandFor(probability);

        return {
          choreId: target.choreId,
          choreTitle: target.choreTitle,
          memberId: target.memberId,
          memberName: target.memberName,
          probability,
          band,
          detail: `TabPFN scored ${target.choreTitle} for ${target.memberName} at ${probability.toFixed(3)} from ${training.length} labelled rows.`,
        };
      });

      // Highest risk first: the point of the panel is what to do next.
      results.sort((a, b) => a.probability - b.probability);
      setPredictions(results);
      setEvidence({
        completed: training.filter((r) => r.label === 1).length,
        missed: training.filter((r) => r.label === 0).length,
      });
      setStatus({
        backend,
        precision,
        ready: true,
        error: null,
        trainingRows: training.length,
        modelName: "TabPFN v2",
        attribution: site.tabpfnAttribution,
      });
    } catch (error) {
      setStatus({
        ...IDLE_STATUS,
        trainingRows: training.length,
        error:
          error instanceof Error
            ? `Inference failed: ${error.message}`
            : "Inference failed for an unknown reason.",
      });
      setPredictions([]);
    } finally {
      setRunning(false);
    }
  }, [training, targets]);

  return (
    <section className="tile p-5" aria-labelledby="tabpfn-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="label">Open weights · on-device · TabPFN (Prior Labs)</p>
          <h2 id="tabpfn-heading" className="mt-1 font-display text-2xl font-semibold">
            Will it actually get done?
          </h2>
        </div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={running}
          className="btn btn-primary"
          data-testid="tabpfn-run"
        >
          {running ? (
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          ) : (
            <Play size={16} aria-hidden="true" />
          )}
          {running ? "Running in your browser" : status.ready ? "Run again" : "Run TabPFN locally"}
        </button>
      </div>

      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-soft">
        The fair-share engine above is deterministic: it knows who is carrying what. This asks a different question —
        given this chore, on this date, at this effort, assigned to this person at this point in their load, how likely
        is it to actually get done? It fits TabPFN v2 on{" "}
        <strong className="text-ink">
          {evidence.completed + evidence.missed > 0 ? evidence.completed : training.filter((r) => r.label === 1).length}{" "}
          completed and {evidence.missed > 0 ? evidence.missed : training.filter((r) => r.label === 0).length} missed
        </strong>{" "}
        chore(s) from your own board. The weights are downloaded once, the training runs in this tab, and nothing about
        your household is sent anywhere.
      </p>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <Stat label="Backend" value={status.ready ? status.backend.toUpperCase() : "not loaded"} />
        <Stat label="Precision" value={status.ready ? (status.precision ?? "—").toUpperCase() : "—"} />
        <Stat label="Training rows" value={String(training.length)} />
      </div>

      <p className="mt-3 flex items-start gap-1.5 text-[11px] text-ink-faint">
        <ShieldCheck size={13} className="mt-0.5 shrink-0 text-verdigris" aria-hidden="true" />
        {site.tabpfnAttribution}. Model weights are covered by the Prior Labs licence; the WebTabPFN runtime is
        Apache-2.0. Inference happens in your browser, so no completion data leaves this device.
      </p>

      {status.error ? (
        <p
          role="status"
          className="mt-4 flex items-start gap-2 rounded-lg border-2 border-saffron/60 bg-saffron-wash p-3 text-sm leading-relaxed text-saffron"
          data-testid="tabpfn-error"
        >
          <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{status.error}</span>
        </p>
      ) : null}

      {status.ready && predictions.length > 0 ? (
        <div className="mt-5">
          <p className="label">Least likely first · {predictions.length} pairings scored</p>
          <ul className="mt-3 space-y-2" data-testid="tabpfn-results">
            {predictions.slice(0, 8).map((prediction) => (
              <li key={`${prediction.choreId}:${prediction.memberId}`} className="tile-sunk p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold">
                    {prediction.choreTitle} · {prediction.memberName}
                  </span>
                  <span
                    className={`rounded-md border px-1.5 py-0.5 text-[11px] font-semibold uppercase ${
                      prediction.band === "likely"
                        ? "border-verdigris/40 bg-verdigris-wash text-verdigris"
                        : prediction.band === "at-risk"
                          ? "border-terracotta/50 bg-terracotta-wash text-terracotta-deep"
                          : "border-grout bg-plate text-ink-soft"
                    }`}
                  >
                    {prediction.band} · {prediction.probability.toFixed(2)}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-grout-soft" aria-hidden="true">
                  <div
                    className="h-full rounded-full bg-terracotta"
                    style={{ width: `${Math.round(prediction.probability * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
            These are priors fitted on a very small table — a household has tens of rows, not the thousands TabPFN was
            designed for. Read them as a nudge toward whoever scores lowest, not as a verdict on anybody.
          </p>
        </div>
      ) : null}

      {status.ready ? null : training.length > 0 ? (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-grout bg-plate-sunk p-3 text-xs leading-relaxed text-ink-soft">
          <Cpu size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          The model has not been loaded yet, so no probabilities are shown. Nothing here is estimated or pre-filled.
        </p>
      ) : null}

      <details className="mt-4">
        <summary className="cursor-pointer text-[13px] font-medium text-ink-soft underline-offset-4 hover:underline">
          The eight features TabPFN sees
        </summary>
        <ol className="mt-2 grid gap-1 text-xs text-ink-soft sm:grid-cols-2">
          {TABPFN_FEATURES.map((feature, index) => (
            <li key={feature} className="tile-sunk px-2 py-1.5">
              <span className="stamp text-ink-faint">{index + 1}.</span> <code>{feature}</code>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="tile-sunk px-3 py-2">
      <p className="label">{label}</p>
      <p className="stamp mt-0.5 text-sm font-semibold">{value}</p>
    </div>
  );
}