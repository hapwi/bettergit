/**
 * Git statistics — commit history data for dashboard charts.
 */
import { serverFetch } from "../server";
import type { RepoStats, RecentCommit, DashboardOverview, DashboardData } from "../../../shared/stats";
import type { PrListItem } from "../../../shared/github";
export type {
  DailyCommitStat,
  AuthorStat,
  RepoStats,
  RecentCommit,
  DashboardOverview,
  DashboardData,
  DashboardHotspot,
  DashboardStaleBranch,
  DashboardReleaseSummary,
} from "../../../shared/stats";
export type { PrListItem } from "../../../shared/github";

export async function getRepoStats(cwd: string, days = 30): Promise<RepoStats> {
  return serverFetch("/api/git/stats", { cwd, days });
}

export async function getDashboardData(
  cwd: string,
  days = 30,
  recentCommitCount = 15,
  mergedPrLimit = 10,
): Promise<DashboardData> {
  return serverFetch("/api/git/dashboard/data", { cwd, days, recentCommitCount, mergedPrLimit });
}

export async function getDashboardOverview(cwd: string, days = 30): Promise<DashboardOverview> {
  return serverFetch("/api/git/dashboard/overview", { cwd, days });
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
