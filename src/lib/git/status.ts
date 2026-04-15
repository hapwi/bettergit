/**
 * Git status — rich repo status matching hapcode's model.
 */
import { serverFetch } from "../server";
import { execGit } from "./exec";
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

export interface WorkingTreeStatusDecoration {
  displayStatus: WorkingTreeDisplayStatus;
  rawStatus: string;
}

const WORKING_TREE_STATUS_PRIORITY: Record<WorkingTreeDisplayStatus, number> = {
  C: 5,
  D: 4,
  R: 3,
  A: 2,
  M: 1,
  U: 0,
};

export function getWorkingTreeDisplayStatusPriority(status: WorkingTreeDisplayStatus): number {
  return WORKING_TREE_STATUS_PRIORITY[status];
}

export function getWorkingTreeDisplayStatusLabel(status: WorkingTreeDisplayStatus): string {
  switch (status) {
    case "A":
      return "Added";
    case "C":
      return "Conflict";
    case "D":
      return "Deleted";
    case "M":
      return "Modified";
    case "R":
      return "Renamed";
    case "U":
      return "Untracked";
  }
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

export async function getStatus(cwd: string): Promise<GitStatus> {
  return serverFetch("/api/git/status", { cwd });
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  const status = await getStatus(cwd);
  return status.isRepo;
}

export async function getRepoRoot(cwd: string): Promise<string | null> {
  const result = await execGit(cwd, ["rev-parse", "--show-toplevel"]);
  return result.code === 0 ? result.stdout.trim() : null;
}
