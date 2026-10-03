"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play, Terminal } from "lucide-react";
import { site } from "@/config/site";

interface MemberLite {
  id: string;
  name: string;
}
interface ChoreLite {
  id: string;
  title: string;
  status: string;
}

interface LogEntry {
  label: string;
  request: unknown;
  response: unknown;
  ok: boolean;
  ms: number;
  error?: string;
}

/** Build a `tools/call` request. Hoisted so the memo below has no closures. */
function tool(name: string, boardToken: string, args: Record<string, unknown>) {
  return {
    jsonrpc: "2.0",
    id: nextId(),
    method: "tools/call",
    params: { name, arguments: { boardToken, ...args } },
  };
}

/**
 * In-page MCP console.
 *
 * Deliberately not a mock: every row below performs a real `fetch` to
 * /api/mcp with a JSON-RPC body, and the response printed is whatever the
 * server actually said — including its errors. If a call fails, the failure is
 * shown as text, not replaced by a reassuring placeholder.
 */
export function AgentConsole({
  endpoint,
  boardToken,
  members,
  chores,
}: {
  endpoint: string;
  boardToken: string;
  members: MemberLite[];
  chores: ChoreLite[];
}) {
  const router = useRouter();
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [raw, setRaw] = useState("");

  const firstMember = members[0]?.id ?? "";
  const openChore = chores.find((c) => c.status === "open" || c.status === "claimed")?.id ?? chores[0]?.id ?? "";

  /** Placeholder ids are replaced at call time so the buttons work immediately. */
  const calls = useMemo(
    () => [
      {
        id: "initialize",
        label: "initialize",
        describe: "Protocol handshake and server capabilities.",
        build: () => ({ jsonrpc: "2.0", id: nextId(), method: "initialize", params: {} }),
      },
      {
        id: "tools-list",
        label: "tools/list",
        describe: "Eleven typed tools with JSON Schemas for every argument.",
        build: () => ({ jsonrpc: "2.0", id: nextId(), method: "tools/list", params: {} }),
      },
      {
        id: "get-household",
        label: "get_household",
        describe: "Read the household and its roster. Needs your board token.",
        build: () => tool("get_household", boardToken, {}),
      },
      {
        id: "list-chores",
        label: "list_chores",
        describe: "Read the chore board with assignees resolved to names.",
        build: () => tool("list_chores", boardToken, { limit: 5 }),
      },
      {
        id: "compute-fairness",
        label: "compute_fairness",
        describe: "Run the deterministic engine — same function the board uses.",
        build: () => tool("compute_fairness", boardToken, { refreshContext: false }),
      },
      {
        id: "create-chore",
        label: "create_chore",
        describe: "Mutating tool. Writes a chore and appends a sealed audit event.",
        build: () =>
          tool("create_chore", boardToken, {
            title: `Agent-added chore ${new Date().toISOString().slice(11, 19)}`,
            category: "admin",
            effortMinutes: 10,
            dueOn: new Date().toISOString().slice(0, 10),
            idempotencyKey: `agent-${Date.now().toString(36)}`,
          }),
      },
      {
        id: "complete-chore",
        label: "complete_chore",
        describe: "Mutating tool. Writes a completion and flips the chore to done.",
        build: () => {
          const memberId = firstMember;
          if (!openChore || !memberId) return null;
          return tool("complete_chore", boardToken, { choreId: openChore, memberId });
        },
      },
      {
        id: "verify",
        label: "verify_integrity",
        describe: "Replay the SHA-384 chain and report the first broken link.",
        build: () => tool("verify_integrity", boardToken, {}),
      },
    ],
    [boardToken, firstMember, openChore],
  );

  async function send(label: string, body: unknown) {
    if (!body) return;
    setBusy(label);
    const started = performance.now();
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "x-griha-token": boardToken },
        body: JSON.stringify(body),
      });
      const json = await response.json();
      const ms = Math.round(performance.now() - started);

      const isError =
        Boolean((json as { error?: unknown }).error) ||
        Boolean((json as { result?: { isError?: boolean } }).result?.isError);

      setLog((prev) => [
        { label, request: body, response: json, ok: response.ok && !isError, ms },
        ...prev,
      ]);
      router.refresh();
    } catch (error) {
      setLog((prev) => [
        {
          label,
          request: body,
          response: null,
          ok: false,
          ms: Math.round(performance.now() - started),
          error: error instanceof Error ? error.message : "network failure",
        },
        ...prev,
      ]);
    } finally {
      setBusy(null);
    }
  }

  async function sendRaw() {
    if (!raw.trim()) return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      setRaw("");
      await send("custom", parsed);
    } catch (error) {
      setLog((prev) => [
        {
          label: "custom",
          request: raw,
          response: null,
          ok: false,
          ms: 0,
          error: `Not valid JSON: ${error instanceof Error ? error.message : "parse error"}`,
        },
        ...prev,
      ]);
    }
  }

  return (
    <div className="space-y-5">
      <section className="tile p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Terminal size={16} aria-hidden="true" className="text-verdigris" />
          <span className="stamp text-sm font-semibold">{site.url}{endpoint}</span>
          <span className="stamp text-xs text-ink-faint">board token supplied as an X-Griha-Token header</span>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {calls.map((call) => (
            <button
              key={call.id}
              type="button"
              onClick={() => void send(call.label, call.build())}
              disabled={busy !== null || call.build() === null}
              className="btn btn-secondary !min-h-0 !px-3 !py-2.5 !text-left !text-[13px]"
              data-testid={`mcp-${call.id}`}
            >
              <span className="flex w-full items-center gap-1.5">
                {busy === call.label ? (
                  <Loader2 size={13} className="animate-spin shrink-0" aria-hidden="true" />
                ) : (
                  <Play size={12} className="shrink-0" aria-hidden="true" />
                )}
                <code className="font-semibold">{call.label}</code>
              </span>
              <span className="mt-1 block text-[11px] leading-snug font-normal text-ink-soft">{call.describe}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="tile p-5">
        <label className="label" htmlFor="raw-rpc">
          Send your own JSON-RPC
        </label>
        <textarea
          id="raw-rpc"
          className="field stamp mt-2 h-28 w-full resize-y text-[11px] leading-relaxed"
          value={raw}
          onChange={(event) => setRaw(event.target.value)}
          placeholder='{"jsonrpc":"2.0","id":9,"method":"tools/list"}'
        />
        <button
          type="button"
          onClick={() => void sendRaw()}
          disabled={busy !== null || !raw.trim()}
          className="btn btn-primary mt-2"
        >
          Send request
        </button>
      </section>

      {log.length === 0 ? (
        <div className="tile p-6 text-center">
          <p className="font-display text-lg font-semibold">No calls yet</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">
            Pick one above. The request and the server&apos;s actual response both appear here — nothing is
            pre-filled, and errors are shown rather than hidden.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {log.map((entry, index) => (
            <li key={`${entry.label}-${index}`} className="tile overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-grout bg-plate-sunk px-4 py-2">
                <code className="text-[13px] font-semibold">{entry.label}</code>
                <span className="stamp text-xs">
                  <span className={entry.ok ? "text-verdigris" : "text-terracotta-deep"}>
                    {entry.ok ? "ok" : "error"}
                  </span>{" "}
                  · {entry.ms} ms
                </span>
              </div>
              <div className="grid gap-px bg-grout lg:grid-cols-2">
                <div className="bg-plate p-3">
                  <p className="label">Request</p>
                  <pre className="stamp mt-1.5 max-h-56 overflow-auto text-[11px] leading-relaxed">
                    {JSON.stringify(entry.request, null, 2)}
                  </pre>
                </div>
                <div className="bg-plate p-3">
                  <p className="label">Response</p>
                  <pre className="stamp mt-1.5 max-h-56 overflow-auto text-[11px] leading-relaxed">
                    {entry.error ?? (entry.response ? JSON.stringify(entry.response, null, 2) : "no response")}
                  </pre>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

let counter = 0;
function nextId(): number {
  counter += 1;
  return counter;
}