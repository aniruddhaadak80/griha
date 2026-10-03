/**
 * Route-handler helpers.
 *
 * Centralises three things every handler would otherwise repeat: resolving the
 * repository, resolving the owner scope, and turning a store failure into a 503
 * instead of an unhandled rejection. It also exposes `ensureHouseholdFor`
 * because "this session has no household yet" is a normal first-run state, not
 * an error.
 */

import { getRepository, type Repository } from "./repository";
import { checkWriteRate, clientKey, getSessionId, requestIsSecure } from "./session";
import { ensureHousehold, loadBundle, type HouseholdBundle } from "./service";
import { StoreUnavailableError } from "./errors";
import type { Household } from "./types";

export interface ResolvedRequest {
  repo: Repository;
  ownerId: string;
  household: Household;
  bundle: HouseholdBundle;
}

export interface ResolveOptions {
  /** House name/city/country used when a household is created on first contact. */
  defaults?: { name: string; city: string; country: string };
  /** Return null instead of seeding when the session has no household yet. */
  requireExisting?: boolean;
}

export const DEFAULT_HOUSEHOLD = { name: "Our Home", city: "New Delhi", country: "IN" };

export async function resolveHousehold(
  request: Request,
  options: ResolveOptions = {},
): Promise<ResolvedRequest | null> {
  let repo: Repository;
  let ownerId: string;
  try {
    repo = await getRepository();
    ownerId = await getSessionId({ secure: requestIsSecure(request) });
  } catch (error) {
    throw new StoreUnavailableError(
      error instanceof Error ? error.message : "The household store is unavailable.",
    );
  }

  const existing = await repo.getHousehold(ownerId);

  if (!existing) {
    if (options.requireExisting) return null;
    await ensureHousehold(repo, ownerId, options.defaults ?? DEFAULT_HOUSEHOLD, new Date());
  }

  const household = await repo.getHousehold(ownerId);
  if (!household) {
    if (options.requireExisting) return null;
    throw new StoreUnavailableError("Could not create a household for this session.");
  }

  const bundle = await loadBundle(repo, ownerId);
  return { repo, ownerId, household, bundle };
}

/**
 * Reject anonymous writes above a per-process ceiling.
 *
 * Serverless instances do not share memory, so this only throttles traffic that
 * lands on the same warm instance. The README says so plainly rather than
 * presenting it as a hard rate limit.
 */
export function assertWriteAllowed(request: Request): void {
  const verdict = checkWriteRate(clientKey(request));
  if (verdict.allowed) return;

  const error = new Error(
    `Too many writes from this address. Try again in ${verdict.retryAfterSeconds} seconds.`,
  ) as Error & { status: number; code: string; retryAfter: number };
  error.status = 429;
  error.code = "rate_limited";
  error.retryAfter = verdict.retryAfterSeconds;
  throw error;
}