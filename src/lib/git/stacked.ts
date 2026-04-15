/**
 * Stacked git actions — the commit → push → PR pipeline.
 */
import { serverFetch } from "../server";
import type { StackedActionInput, StackedActionResult } from "../../../shared/stacked";
export type { StackedAction, StackedActionInput, StackedActionResult } from "../../../shared/stacked";

export async function runStackedAction(input: StackedActionInput): Promise<StackedActionResult> {
  return serverFetch("/api/git/actions/stacked", input);
}
