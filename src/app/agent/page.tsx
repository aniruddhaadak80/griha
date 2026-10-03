import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { AgentConsole } from "@/components/agent-console";
import { getRepository } from "@/lib/repository";
import { peekSessionId } from "@/lib/session";
import { loadBundle } from "@/lib/service";
import { site } from "@/config/site";

export const metadata: Metadata = {
  title: "Agent console",
  description:
    "A live MCP JSON-RPC 2.0 console against the Griha endpoint. Eleven typed tools, including a mutating path identical to the web UI.",
  alternates: { canonical: "/agent" },
};

export const dynamic = "force-dynamic";

export default async function AgentPage() {
  const repo = await getRepository();
  const ownerId = await peekSessionId();
  if (!ownerId) redirect("/api/bootstrap?next=/agent");

  const bundle = await loadBundle(repo, ownerId);

  return (
    <>
      <PageHeader
        eyebrow="Agent"
        title="MCP JSON-RPC console"
        lede="These are real requests to Griha's own /api/mcp endpoint, sent from your browser. The mutation tools call the same service functions the buttons do, so anything you do here is indistinguishable on the board and in the audit chain."
      />

      <div className="mx-auto w-full max-w-6xl px-4 py-8">
        <AgentConsole
          endpoint="/api/mcp"
          boardToken={bundle.household.apiToken}
          members={bundle.members.map((m) => ({ id: m.id, name: m.name }))}
          chores={bundle.chores.slice(0, 6).map((c) => ({ id: c.id, title: c.title, status: c.status }))}
        />

        <section className="tile mt-6 p-5">
          <p className="label">Use it from an agent</p>
          <h2 className="mt-1 font-display text-xl font-semibold">Point any MCP client here</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            The published descriptor at{" "}
            <a href="/mcp.json" className="underline underline-offset-4">
              /mcp.json
            </a>{" "}
            carries the live endpoint. Tools need your board token, which lives on the{" "}
            <a href="/settings" className="underline underline-offset-4">
              Settings
            </a>{" "}
            page — an MCP client is an external program, so it presents an explicit credential rather than inheriting
            your browser session.
          </p>
          <pre className="stamp mt-3 overflow-x-auto rounded-lg border border-grout bg-plate-sunk p-3 text-[11px] leading-relaxed">
{`curl -sS ${site.url}/api/mcp \\
  -H 'content-type: application/json' \\
  -H 'x-griha-token: <board token>' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"compute_fairness",
                 "arguments":{"boardToken":"<board token>"}}}'`}
          </pre>
        </section>
      </div>
    </>
  );
}