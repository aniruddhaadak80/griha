"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, Plus } from "lucide-react";
import { apiFetch, ApiError } from "@/components/api-client";
import type { Member } from "@/lib/types";

/**
 * Settings.
 *
 * This is where the two credentials live, and the copy explains the difference
 * between them rather than presenting two identical-looking strings:
 *   - the share token grants read access to a public URL;
 *   - the board token grants read and write to the MCP endpoint.
 *
 * Both are shown in full to their owner, and neither is ever logged, exported
 * into a URL bar by default, or sent anywhere except Griha's own server.
 */
export function SettingsPanel({
  household,
  members,
  persistence,
}: {
  household: { id: string; name: string; city: string; country: string; shareToken: string; apiToken: string };
  members: Member[];
  persistence: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(household.name);
  const [city, setCity] = useState(household.city);
  const [country, setCountry] = useState(household.country);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [memberName, setMemberName] = useState("");
  const [memberCapacity, setMemberCapacity] = useState("1");
  const [addingMember, setAddingMember] = useState(false);
  const [, startTransition] = useTransition();

  async function saveHousehold(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await apiFetch("/api/household", {
        method: "PATCH",
        json: { name, city, country },
      });
      const seal = result.meta.seal?.slice(0, 12);
      setMessage(`Saved${seal ? ` · seal ${seal}…` : ""}. The next context fetch uses the new city and country.`);
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not save those settings.");
    } finally {
      setSaving(false);
    }
  }

  async function addMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAddingMember(true);
    setError(null);
    try {
      await apiFetch("/api/members", {
        method: "POST",
        json: { name: memberName, capacity: Number(memberCapacity) },
      });
      setMemberName("");
      setMemberCapacity("1");
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not add that member.");
    } finally {
      setAddingMember(false);
    }
  }

  async function updateCapacity(memberId: string, capacity: number) {
    setError(null);
    try {
      await apiFetch("/api/members", { method: "PATCH", json: { memberId, capacity } });
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not change that capacity.");
    }
  }

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("The browser blocked clipboard access. Select the text and copy it manually.");
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
      <div className="space-y-6">
        <form onSubmit={saveHousehold} className="tile space-y-4 p-5">
          <p className="label">Household</p>

          <label className="block">
            <span className="label">Name</span>
            <input className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">City (drives the forecast)</span>
              <input className="field mt-1" value={city} onChange={(e) => setCity(e.target.value)} maxLength={60} required />
              <span className="mt-1 block text-[11px] text-ink-faint">
                Open-Meteo needs coordinates, so Griha resolves the city against a built-in table. Unknown cities fall
                back to a default location and say so.
              </span>
            </label>

            <label className="block">
              <span className="label">Country code (drives the holidays)</span>
              <input
                className="field stamp mt-1 uppercase"
                value={country}
                onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))}
                minLength={2}
                maxLength={2}
                pattern="[A-Za-z]{2}"
                required
              />
              <span className="mt-1 block text-[11px] text-ink-faint">ISO 3166 alpha-2, e.g. IN, GB, US, DE.</span>
            </label>
          </div>

          {error ? (
            <p role="alert" className="rounded-lg border border-terracotta/50 bg-terracotta-wash px-3 py-2 text-sm text-terracotta-deep">
              {error}
            </p>
          ) : null}
          {message ? (
            <p role="status" className="rounded-lg border border-verdigris/40 bg-verdigris-wash px-3 py-2 text-sm text-verdigris">
              {message}
            </p>
          ) : null}

          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : null}
            Save household
          </button>
        </form>

        <section className="tile p-5">
          <p className="label">Members and capacity</p>
          <h2 className="mt-1 font-display text-xl font-semibold">
            {members.length} member{members.length === 1 ? "" : "s"}
          </h2>

          <ul className="mt-4 space-y-2">
            {members.map((member) => (
              <li key={member.id} className="tile-sunk flex flex-wrap items-center gap-3 p-3">
                <span className="font-semibold">{member.name}</span>
                <label className="ml-auto flex items-center gap-2">
                  <span className="label">Capacity</span>
                  <input
                    type="number"
                    min={0.2}
                    max={3}
                    step={0.1}
                    defaultValue={member.capacity}
                    aria-label={`Capacity weight for ${member.name}`}
                    onBlur={(event) => {
                      const next = Number(event.target.value);
                      if (Number.isFinite(next) && next !== member.capacity) {
                        void updateCapacity(member.id, next);
                      }
                    }}
                    className="field stamp !min-h-9 !w-20 !py-1"
                  />
                </label>
              </li>
            ))}
          </ul>

          <form onSubmit={addMember} className="mt-4 flex flex-wrap items-end gap-2 border-t border-grout pt-4">
            <label className="flex-1">
              <span className="label">Add someone</span>
              <input
                className="field mt-1"
                value={memberName}
                onChange={(e) => setMemberName(e.target.value)}
                placeholder="Name"
                maxLength={40}
                required
              />
            </label>
            <label className="w-28">
              <span className="label">Capacity</span>
              <input
                className="field stamp mt-1"
                type="number"
                min={0.2}
                max={3}
                step={0.1}
                value={memberCapacity}
                onChange={(e) => setMemberCapacity(e.target.value)}
              />
            </label>
            <button type="submit" className="btn btn-secondary" disabled={addingMember}>
              {addingMember ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
              Add
            </button>
          </form>

          <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
            Capacity is a relative weight, not hours. A household of three where one person works nights sets that
            person to 0.7 and everyone to 1.0, and the engine will stop reading their lighter load as unfairness.
          </p>
        </section>
      </div>

      <div className="space-y-6">
        <section className="tile p-5">
          <p className="label">Credentials</p>
          <h2 className="mt-1 font-display text-xl font-semibold">Two tokens, two grants</h2>

          <div className="mt-4 space-y-4">
            <div className="tile-sunk p-3">
              <p className="tile-label text-ink">Share token · read only</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                Opens <code>/share/&lt;token&gt;</code> in a browser. Anyone with it can see the board and nothing else.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="stamp min-w-0 flex-1 truncate rounded border border-grout bg-plate px-2 py-1 text-[11px]">
                  {household.shareToken}
                </code>
                <button
                  type="button"
                  onClick={() => void copy("share", household.shareToken)}
                  className="btn btn-quiet !min-h-9 !px-2 !text-[12px]"
                >
                  {copied === "share" ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                  {copied === "share" ? "Copied" : "Copy"}
                </button>
              </div>
            </div>

            <div className="tile-sunk p-3">
              <p className="tile-label text-ink">Board token · read and write</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                Authorises the MCP endpoint. An agent needs this because it has no browser session to inherit.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code
                  className="stamp min-w-0 flex-1 truncate rounded border border-grout bg-plate px-2 py-1 text-[11px]"
                  data-testid="board-token"
                >
                  {household.apiToken}
                </code>
                <button
                  type="button"
                  onClick={() => void copy("board", household.apiToken)}
                  className="btn btn-quiet !min-h-9 !px-2 !text-[12px]"
                >
                  {copied === "board" ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                  {copied === "board" ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="mt-2 text-[11px] text-ink-faint">
                Treat it like a password. Anyone holding it can change your board. Revoking means creating a new
                household, which the roadmap will make a first-class action.
              </p>
            </div>
          </div>
        </section>

        <section className="tile p-5">
          <p className="label">Where your data lives</p>
          <h2 className="mt-1 font-display text-xl font-semibold">
            {persistence === "neon-postgres" ? "Hosted Postgres" : "Embedded database"}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            {persistence === "neon-postgres"
              ? "Your board is in hosted Postgres and survives redeploys and cold starts. In production Griha refuses to boot at all without a connection string, rather than quietly falling back to something that would lose your chores."
              : "Local development is using an embedded Postgres in the same process, so the app runs with zero configuration. Set DATABASE_URL to point at a hosted database and it switches adapters automatically."}
          </p>
          <p className="stamp mt-3 text-[11px] text-ink-faint">adapter: {persistence}</p>
        </section>
      </div>
    </div>
  );
}