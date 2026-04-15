/**
 * GitHub CLI operations — PR management via `gh`.
 */
import { serverFetch } from "../server";
import type { PullRequestSummary, GhAuthStatus, GhRepo, GhViewer } from "../../../shared/github";
export type { PullRequestSummary, GhAuthStatus, GhRepo, GhViewer } from "../../../shared/github";

export async function listOpenPullRequests(
  cwd: string,
  headBranch: string,
): Promise<PullRequestSummary[]> {
  return serverFetch("/api/github/prs/open", { cwd, headBranch });
}

export async function getPullRequest(
  cwd: string,
  reference: string,
): Promise<PullRequestSummary | null> {
  return serverFetch("/api/github/pr", { cwd, reference });
}

export async function createPullRequest(
  cwd: string,
  baseBranch: string,
  title: string,
  body: string,
): Promise<PullRequestSummary> {
  return serverFetch("/api/github/pr/create", { cwd, baseBranch, title, body });
}

export async function mergePullRequest(
  cwd: string,
  reference: string,
  method: "merge" | "squash" | "rebase" = "squash",
  deleteBranch = true,
): Promise<void> {
  await serverFetch("/api/github/pr/merge", { cwd, reference, method, deleteBranch });
}

export async function createGhRepo(
  cwd: string,
  visibility: "public" | "private" = "private",
): Promise<void> {
  await serverFetch("/api/github/repo/create", { cwd, visibility });
}

export async function getGhDefaultBranch(cwd: string): Promise<string | null> {
  return serverFetch("/api/github/repo/default-branch", { cwd });
}

export async function getForkParent(cwd: string): Promise<string | null> {
  return serverFetch("/api/github/repo/fork-parent", { cwd });
}

export async function getGhAuthStatus(cwd: string): Promise<GhAuthStatus> {
  return serverFetch("/api/github/auth-status", { cwd });
}

export async function getGhViewer(cwd: string): Promise<GhViewer | null> {
  return serverFetch("/api/github/viewer", { cwd });
}

export async function listGhRepos(limit = 100): Promise<GhRepo[]> {
  return serverFetch("/api/github/repos/list", { limit });
}

export async function cloneGhRepo(
  repo: string,
  destination: string,
): Promise<{ clonedPath: string }> {
  return serverFetch("/api/github/repos/clone", { repo, destination });
}
