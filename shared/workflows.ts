export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

export interface MergePullRequestsInput {
  cwd: string;
  scope: "current" | "stack";
  prs: Array<{
    number: number;
    headBranch: string;
    baseBranch: string;
  }>;
  versionBump?: "patch" | "minor" | "major" | null;
}

export interface MergePullRequestsResult {
  merged: number[];
  tag: string | null;
  finalBranch: string | null;
  error: string | null;
}

export interface VersionBumpInput {
  cwd: string;
  bump: "patch" | "minor" | "major";
}

export interface VersionBumpResult {
  tag: string;
  version: string;
  error: string | null;
}
