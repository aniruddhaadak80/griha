"use client";

import { useState } from "react";
import { BalanceBar } from "@/components/balance-bar";
import type { MemberFairness } from "@/lib/types";

/**
 * Client wrapper for the fair-share bar.
 *
 * A Server Component cannot pass an event handler into a Client Component, so
 * pages render this instead of wiring `onSelect` themselves. Selection state
 * lives here; the pages stay server-rendered and free of callbacks.
 */
export function LiveBalanceBar({ members }: { members: MemberFairness[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return <BalanceBar members={members} selectedId={selectedId} onSelect={setSelectedId} />;
}

/**
 * Read-only variant for pages that must not offer selection at all, such as the
 * public share route — where clicking a segment would imply something that the
 * viewer is not allowed to do.
 */
export function StaticBalanceBar({ members }: { members: MemberFairness[] }) {
  return <BalanceBar members={members} selectedId={null} onSelect={() => {}} />;
}