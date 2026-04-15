/**
 * Git statistics — commit history data for dashboard charts.
 */
import { serverFetch } from "../server";
import type { RepoStats, RecentCommit } from "../../../shared/stats";
import type { PrListItem } from "../../../shared/github";
export type { DailyCommitStat, AuthorStat, RepoStats, RecentCommit } from "../../../shared/stats";
export type { PrListItem } from "../../../shared/github";

export async function getRepoStats(cwd: string, days = 30): Promise<RepoStats> {
  return serverFetch("/api/git/stats", { cwd, days });
}

export async function getRecentCommits(cwd: string, count = 20): Promise<RecentCommit[]> {
  return serverFetch("/api/git/dashboard/recent-commits", { cwd, count });
}

export async function getOpenPrs(cwd: string): Promise<PrListItem[]> {
  return serverFetch("/api/git/dashboard/open-prs", { cwd });
}

export async function getMergedPrs(cwd: string, limit = 10): Promise<PrListItem[]> {
  return serverFetch("/api/git/dashboard/merged-prs", { cwd, limit });
}
