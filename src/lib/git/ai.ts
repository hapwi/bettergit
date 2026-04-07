/**
 * AI text generation — commit messages, PR content, branch names via Claude CLI.
 */

function getAPI() {
  const api = window.electronAPI;
  if (!api) throw new Error("Electron API not available");
  return api;
}

export interface CommitMessageResult {
  subject: string;
  body: string;
  branch?: string;
}

export interface PrContentResult {
  title: string;
  body: string;
}

export interface BranchNameResult {
  branch: string;
}

export async function generateCommitMessage(input: {
  cwd: string;
  branch: string | null;
  stagedSummary: string;
  stagedPatch: string;
  includeBranch?: boolean;
}): Promise<CommitMessageResult> {
  return getAPI().ai.generateCommitMessage(input);
}

export async function generatePrContent(input: {
  cwd: string;
  baseBranch: string;
  headBranch: string;
  commitSummary: string;
  diffSummary: string;
  diffPatch: string;
}): Promise<PrContentResult> {
  return getAPI().ai.generatePrContent(input);
}

export async function generateBranchName(input: {
  message: string;
}): Promise<BranchNameResult> {
  return getAPI().ai.generateBranchName(input);
}
