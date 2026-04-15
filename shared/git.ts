import type { PullRequestSummary } from "./github";

export type WorkingTreeDisplayStatus = "M" | "A" | "D" | "R" | "C" | "U";

export interface WorkingTreeFile {
  path: string;
  insertions: number;
  deletions: number;
  rawStatus: string;
  indexStatus: string;
  workingTreeStatus: string;
  displayStatus: WorkingTreeDisplayStatus;
  originalPath?: string;
}

export interface GitStatus {
  branch: string | null;
  isDetached: boolean;
  isRepo: boolean;
  hasCommits: boolean;
  hasOriginRemote: boolean;
  hasWorkingTreeChanges: boolean;
  workingTree: {
    files: WorkingTreeFile[];
    insertions: number;
    deletions: number;
  };
  hasUpstream: boolean;
  aheadCount: number;
  behindCount: number;
  pr: PullRequestSummary | null;
}

export interface Branch {
  name: string;
  current: boolean;
  isRemote: boolean;
  isDefault: boolean;
  upstream: string | null;
}

export interface CommitEntry {
  sha: string;
  shortSha: string;
  subject: string;
  body: string;
  author: string;
  date: string;
  relativeDate: string;
}
