/**
 * Input validation.
 *
 * Every value that crosses the network boundary — form body, query string,
 * MCP tool arguments — passes through here before it reaches the repository.
 * Nothing is interpolated into SQL unsafely, and no string reaches a page
 * without a length bound.
 */

import { CHORE_CATEGORIES, CHORE_STATUSES, type ChoreCategory, type ChoreStatus } from "./types";

export class ValidationError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = "ValidationError";
    this.field = field;
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const LIMITS = {
  householdName: 60,
  city: 60,
  memberName: 40,
  choreTitle: 120,
  choreNote: 400,
  idempotencyKey: 80,
  effortMinutesMax: 24 * 60,
  capacityMin: 0.2,
  capacityMax: 3,
  shareToken: 64,
} as const;

export function requireString(
  value: unknown,
  field: string,
  { min = 1, max = 200, pattern }: { min?: number; max?: number; pattern?: RegExp } = {},
): string {
  if (typeof value !== "string") throw new ValidationError(field, `${field} must be a string.`);
  const trimmed = value.trim();
  if (trimmed.length < min) throw new ValidationError(field, `${field} must be at least ${min} character(s).`);
  if (trimmed.length > max) throw new ValidationError(field, `${field} must be at most ${max} characters.`);
  if (pattern && !pattern.test(trimmed)) throw new ValidationError(field, `${field} is not in the expected format.`);
  return trimmed;
}

export function optionalString(
  value: unknown,
  field: string,
  { max = 400 }: { max?: number } = {},
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new ValidationError(field, `${field} must be a string.`);
  const trimmed = value.trim();
  if (trimmed.length === 0) return "";
  if (trimmed.length > max) throw new ValidationError(field, `${field} must be at most ${max} characters.`);
  return trimmed;
}

export function requireIsoDate(value: unknown, field: string): string {
  const text = requireString(value, field, { min: 10, max: 10, pattern: ISO_DATE });
  // Reject dates that parse but do not exist, e.g. 2026-02-31.
  const parsed = Date.parse(`${text}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== text) {
    throw new ValidationError(field, `${field} is not a real calendar date.`);
  }
  return text;
}

export function optionalIsoDate(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requireIsoDate(value, field);
}

export function requireInt(
  value: unknown,
  field: string,
  { min = 0, max = Number.MAX_SAFE_INTEGER }: { min?: number; max?: number } = {},
): number {
  const num = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof num !== "number" || !Number.isFinite(num) || !Number.isInteger(num)) {
    throw new ValidationError(field, `${field} must be a whole number.`);
  }
  if (num < min || num > max) throw new ValidationError(field, `${field} must be between ${min} and ${max}.`);
  return num;
}

export function optionalInt(
  value: unknown,
  field: string,
  bounds: { min?: number; max?: number } = {},
): number | undefined {
  if (value === undefined || value === null) return undefined;
  return requireInt(value, field, bounds);
}

export function optionalNumber(
  value: unknown,
  field: string,
  bounds: { min?: number; max?: number } = {},
): number | undefined {
  if (value === undefined || value === null) return undefined;
  return requireNumber(value, field, bounds);
}

/** Optional bounded string, for inputs where a minimum is meaningful too. */
export function optionalBoundedString(
  value: unknown,
  field: string,
  { min = 1, max = 200, pattern }: { min?: number; max?: number; pattern?: RegExp } = {},
): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requireString(value, field, { min, max, pattern });
}

export function requireNumber(
  value: unknown,
  field: string,
  { min = -Infinity, max = Infinity }: { min?: number; max?: number } = {},
): number {
  const num = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof num !== "number" || !Number.isFinite(num)) {
    throw new ValidationError(field, `${field} must be a number.`);
  }
  if (num < min || num > max) throw new ValidationError(field, `${field} must be between ${min} and ${max}.`);
  return num;
}

export function requireEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new ValidationError(field, `${field} must be one of: ${allowed.join(", ")}.`);
  }
  return value as T;
}

export function optionalEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T | undefined {
  if (value === undefined || value === null) return undefined;
  return requireEnum(value, field, allowed);
}

export function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new ValidationError(field, `${field} must be true or false.`);
}

export function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  return requireBoolean(value, field);
}

/** Membership ids are UUIDs produced by the repository; anything else is a probe. */
export function requireId(value: unknown, field: string): string {
  return requireString(value, field, { min: 8, max: 64, pattern: /^[A-Za-z0-9_-]+$/ });
}

export function optionalId(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  return requireId(value, field);
}

export function requireCountry(value: unknown, field: string): string {
  return requireString(value, field, { min: 2, max: 2, pattern: /^[A-Za-z]{2}$/ }).toUpperCase();
}

export function parseChoreCategory(value: unknown, field = "category"): ChoreCategory {
  return requireEnum(value, field, CHORE_CATEGORIES);
}

export function parseChoreStatus(value: unknown, field = "status"): ChoreStatus {
  return requireEnum(value, field, CHORE_STATUSES);
}

export function parsePagination(searchParams: URLSearchParams): { limit: number; offset: number } {
  const limit = optionalInt(searchParams.get("limit"), "limit", { min: 1, max: 100 }) ?? 25;
  const offset = optionalInt(searchParams.get("offset"), "offset", { min: 0, max: 100_000 }) ?? 0;
  return { limit, offset };
}