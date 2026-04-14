/**
 * Git status — rich repo status matching hapcode's model.
 */
import { serverFetch } from "../server";
import { execGit } from "./exec";
import type { PullRequestSummary } from "./github";

export interface WorkingTreeFile {
  path: string;
  insertions: number;
  deletions: number;
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
