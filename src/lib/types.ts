/**
 * Domain types and normalised external shapes.
 *
 * Everything the app stores or computes is declared here once, including the
 * normalised form of the two key-free public feeds. External payloads are never
 * allowed past `src/lib/context.ts`, which converts them into these shapes and
 * keeps attribution, fetch time and source status attached.
 */

/* -------------------------------------------------------------------------- */
/* Persisted domain                                                            */
/* -------------------------------------------------------------------------- */

export const CHORE_CATEGORIES = [
  "kitchen",
  "cleaning",
  "laundry",
  "outdoor",
  "maintenance",
  "shopping",
  "pets",
  "admin",
] as const;

export type ChoreCategory = (typeof CHORE_CATEGORIES)[number];

export const CHORE_STATUSES = ["open", "claimed", "done", "skipped"] as const;
export type ChoreStatus = (typeof CHORE_STATUSES)[number];

export interface Household {
  id: string;
  name: string;
  /** Free-text city, used for the weather lookup. */
  city: string;
  /** ISO-3166 alpha-2, used for the public-holiday lookup. */
  country: string;
  ownerId: string;
  /** Unguessable token backing the public read-only share route. */
  shareToken: string;
  /**
   * Unguessable token that authorises the MCP endpoint and the export API for
   * this household. Separate from `shareToken` because the two grants differ:
   * the share token reads a board, this one mutates it. An MCP client is an
   * external program with no ambient cookie, so it must present an explicit
   * credential rather than inherit the browser session.
   */
  apiToken: string;
  createdAt: string;
  updatedAt: string;
  deleted: boolean;
}

export interface Member {
  id: string;
  householdId: string;
  name: string;
  /**
   * Relative capacity weight, 0.2–3.0. Someone who works nights should carry
   * less than a stay-at-home parent; this is the knob that stops the fairness
   * engine from treating every person as identical.
   */
  capacity: number;
  /** Palette token name, not a raw colour, so theming stays centralised. */
  tint: string;
  createdAt: string;
  updatedAt: string;
  deleted: boolean;
}

export interface Chore {
  id: string;
  householdId: string;
  title: string;
  category: ChoreCategory;
  effortMinutes: number;
  /** ISO date (YYYY-MM-DD) the chore is expected on. */
  dueOn: string;
  assigneeId: string | null;
  status: ChoreStatus;
  /** Outdoor chores are weather-sensitive and scored against the forecast. */
  outdoor: boolean;
  note: string;
  createdAt: string;
  updatedAt: string;
  deleted: boolean;
}

export interface Completion {
  id: string;
  householdId: string;
  choreId: string;
  memberId: string;
  /** ISO date the work was actually done. */
  completedOn: string;
  minutesSpent: number;
  createdAt: string;
}

export type AuditAction =
  | "household.created"
  | "household.updated"
  | "member.created"
  | "member.updated"
  | "chore.created"
  | "chore.updated"
  | "chore.claimed"
  | "chore.completed"
  | "chore.skipped"
  | "chore.deleted";

export interface AuditEvent {
  id: string;
  householdId: string;
  action: AuditAction;
  payload: string;
  prevSeal: string;
  seal: string;
  createdAt: string;
  /**
   * Stored insertion order, and the only thing that defines the chain.
   *
   * `createdAt` is deliberately not usable for ordering: a batched write stamps
   * every event in the batch with one instant. Replay therefore follows `seq`.
   */
  seq?: number;
}

export interface CreateChoreInput {
  title: string;
  category: ChoreCategory;
  effortMinutes: number;
  dueOn: string;
  assigneeId?: string | null;
  outdoor?: boolean;
  note?: string;
  idempotencyKey?: string;
}

export interface UpdateChoreInput {
  title?: string;
  category?: ChoreCategory;
  effortMinutes?: number;
  dueOn?: string;
  assigneeId?: string | null;
  outdoor?: boolean;
  note?: string;
  status?: ChoreStatus;
  idempotencyKey?: string;
}

export interface CreateMemberInput {
  name: string;
  capacity?: number;
  tint?: string;
  idempotencyKey?: string;
}

/* -------------------------------------------------------------------------- */
/* Normalised live context                                                     */
/* -------------------------------------------------------------------------- */

export type SourceStatus = "live" | "fallback";

export interface DailyForecast {
  /** ISO date. */
  date: string;
  /** 0–100 probability of precipitation. */
  precipitationProbability: number;
  /** Millimetres. */
  precipitationSum: number;
  /** Metres per second. */
  windSpeed: number;
  /** Degrees Celsius, daily mean. */
  temperatureMean: number;
}

export interface WeatherSnapshot {
  status: SourceStatus;
  city: string;
  latitude: number;
  longitude: number;
  /** ISO timestamp of the upstream fetch. */
  fetchedAt: string;
  source: string;
  sourceUrl: string;
  days: DailyForecast[];
}

export interface PublicHoliday {
  date: string;
  localName: string;
  name: string;
}

export interface HolidaySnapshot {
  status: SourceStatus;
  country: string;
  year: number;
  fetchedAt: string;
  source: string;
  sourceUrl: string;
  days: PublicHoliday[];
}

export interface HouseholdContext {
  weather: WeatherSnapshot;
  holidays: HolidaySnapshot;
  /** Convenience lookup: ISO date -> holiday name. */
  holidayIndex: Record<string, string>;
  /** ISO dates covered by the forecast, for stale-data messaging. */
  coveredThrough: string | null;
}

/* -------------------------------------------------------------------------- */
/* Engine                                                                      */
/* -------------------------------------------------------------------------- */

export interface Factor {
  key: string;
  label: string;
  /** 0–1. The member-level factor weights sum to 1. */
  weight: number;
  /** 0–1 raw sub-score. */
  raw: number;
  /** raw * weight * 100 — the points this factor moved the score. */
  contribution: number;
  /** The arithmetic, written out. */
  detail: string;
}

export type LoadVerdict = "under-loaded" | "fair" | "over-loaded";

export interface MemberFairness {
  memberId: string;
  name: string;
  tint: string;
  capacity: number;
  shareOfCapacity: number;
  minutesDone: number;
  shareOfWork: number;
  /** (shareOfWork − shareOfCapacity) × 100, in percentage points. */
  deviationPoints: number;
  openChores: number;
  overdueChores: number;
  overdueMinutes: number;
  score: number;
  verdict: LoadVerdict;
  factors: Factor[];
}

export interface WeatherFit {
  choreId: string;
  /** 0–1. 1 means an ideal window. */
  suitability: number;
  verdict: "good" | "workable" | "poor";
  detail: string;
}

export interface FairnessRecommendation {
  choreId: string;
  choreTitle: string;
  memberId: string;
  memberName: string;
  reason: string;
  /** Engine version that produced the recommendation. */
  engineVersion: string;
}

export interface FairnessResult {
  version: string;
  computedAt: string;
  windowDays: number;
  /** Household-level fairness, 0–100. */
  fairnessScore: number;
  /** Sum of absolute deviations in percentage points; lower is fairer. */
  spreadPoints: number;
  members: MemberFairness[];
  weatherFit: WeatherFit[];
  recommendation: FairnessRecommendation | null;
  factors: Factor[];
  context: HouseholdContext;
  /** Head seal of the household audit chain at computation time. */
  seal: string;
}

/* -------------------------------------------------------------------------- */
/* TabPFN (open-weights, browser-local)                                        */
/* -------------------------------------------------------------------------- */

/**
 * One row of the training table handed to TabPFN.
 *
 * These are the exact feature names used to fit the model, in this order. The
 * browser builds the table from real completion history; nothing is fabricated
 * and nothing is uploaded.
 */
export const TABPFN_FEATURES = [
  "capacity",
  "categoryShare",
  "effortMinutes",
  "weekday",
  "daysSinceLastOfCategory",
  "assigneeLoadShare",
  "isPublicHoliday",
  "outdoor",
] as const;

export type TabPfnFeature = (typeof TABPFN_FEATURES)[number];

export interface TabPfnTrainingRow {
  features: number[];
  /** 1 when the chore was completed within the window, 0 otherwise. */
  label: 1 | 0;
  /** Human-readable context kept for the UI, never fed to the model. */
  choreTitle: string;
  memberName: string;
  completedOn: string;
}

export interface TabPfnPrediction {
  choreId: string;
  choreTitle: string;
  memberId: string;
  memberName: string;
  /** Model output in [0,1]. */
  probability: number;
  band: "likely" | "uncertain" | "at-risk";
  detail: string;
}

export type TabPfnBackend = "webgpu" | "wasm" | "unavailable";

export interface TabPfnStatus {
  backend: TabPfnBackend;
  precision: "int4" | "int8" | null;
  ready: boolean;
  /** Set when the model could not be loaded; the UI must show this verbatim. */
  error: string | null;
  trainingRows: number;
  modelName: string;
  attribution: string;
}