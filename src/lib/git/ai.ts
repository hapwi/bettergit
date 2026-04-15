/**
 * AI text generation via the bettergit server.
 */
import { serverFetch } from "../server";
import type { CommitMessageResult, PrContentResult, BranchNameResult } from "../../../shared/ai";
export type { CommitMessageResult, PrContentResult, BranchNameResult } from "../../../shared/ai";

export async function generateCommitMessage(input: {
  cwd: string;
  branch: string | null;
  stagedSummary: string;
  stagedPatch: string;
  includeBranch?: boolean;
}): Promise<CommitMessageResult> {
  return serverFetch("/api/ai/commit-msg", input);
}

export async function generatePrContent(input: {
  cwd: string;
  baseBranch: string;
  headBranch: string;
  commitSummary: string;
  diffSummary: string;
  diffPatch: string;
}): Promise<PrContentResult> {
  return serverFetch("/api/ai/pr-content", input);
}

export async function generateBranchName(input: {
  message: string;
}): Promise<BranchNameResult> {
  return serverFetch("/api/ai/branch-name", input);
}
