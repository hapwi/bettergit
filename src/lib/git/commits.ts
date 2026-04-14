/**
 * Commit operations — log, commit, stage, diff.
 */
import { serverFetch } from "../server";

export interface CommitEntry {
  sha: string;
  shortSha: string;
  subject: string;
  body: string;
  author: string;
  date: string;
  relativeDate: string;
}

export async function getLog(
  cwd: string,
  count = 50,
  branch?: string,
): Promise<CommitEntry[]> {
  return serverFetch("/api/git/commits/log", { cwd, count, branch });
}

export async function stageFiles(cwd: string, paths: string[]): Promise<void> {
  await serverFetch("/api/git/commits/stage-files", { cwd, paths });
}

export async function stageAll(cwd: string): Promise<void> {
  await serverFetch("/api/git/commits/stage-all", { cwd });
}

export async function unstageFiles(cwd: string, paths: string[]): Promise<void> {
  await serverFetch("/api/git/commits/unstage-files", { cwd, paths });
}

export async function commit(
  cwd: string,
  message: string,
): Promise<{ sha: string }> {
  return serverFetch("/api/git/commits/create", { cwd, message });
}

export async function getDiff(
  cwd: string,
  staged = false,
): Promise<string> {
  return serverFetch("/api/git/commits/diff", { cwd, staged });
}

export async function discardAllChanges(cwd: string): Promise<void> {
  await serverFetch("/api/git/commits/discard-all", { cwd });
}

/**
 * Get unified diff patch for all local changes (tracked + untracked).
 * Returns a single string suitable for parsePatchFiles from @pierre/diffs.
 */
export async function getFullDiffPatch(cwd: string): Promise<string> {
  return serverFetch("/api/git/commits/full-diff-patch", { cwd });
}

export async function getDiffStat(
  cwd: string,
  staged = false,
): Promise<string> {
  return serverFetch("/api/git/commits/diff-stat", { cwd, staged });
}
