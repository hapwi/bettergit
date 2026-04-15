export interface CommitMessageInput {
  cwd: string;
  branch: string | null;
  stagedSummary: string;
  stagedPatch: string;
  includeBranch?: boolean;
}

export interface CommitMessageResult {
  subject: string;
  body: string;
  branch?: string;
}

export interface PrContentInput {
  cwd: string;
  baseBranch: string;
  headBranch: string;
  commitSummary: string;
  diffSummary: string;
  diffPatch: string;
}

export interface PrContentResult {
  title: string;
  body: string;
}

export interface BranchNameInput {
  message: string;
}

export interface BranchNameResult {
  branch: string;
}
