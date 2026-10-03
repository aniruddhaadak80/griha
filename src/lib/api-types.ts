/**
 * Shared response shapes for the API, so client code and the MCP tools import
 * one set of types instead of re-declaring them per route.
 */

import type { Chore, Completion, FairnessResult, Household, Member } from "./types";

export interface ChoreListResponse {
  chores: Chore[];
  total: number;
  members: Member[];
  household: Household;
  completions: Completion[];
}

export interface FairnessResponse {
  fairness: FairnessResult;
  household: Household;
  choreCount: number;
}

export interface CityContextResponse {
  context: FairnessResult["context"];
  live: boolean;
}

export interface BootstrapResponse {
  household: Household;
  members: Member[];
  chores: Chore[];
  completions: Completion[];
  fairness: FairnessResult;
}