/**
 * Git statistics — commit history data for dashboard charts.
 */
import { serverFetch } from "../server";

export interface DailyCommitStat {
  date: string; // YYYY-MM-DD
  commits: number;
  insertions: number;
  deletions: number;
}

export interface AuthorStat {
  name: string;
  commits: number;
}

export interface RepoStats {
  totalCommits: number;
  totalBranches: number;
  dailyActivity: DailyCommitStat[];
  topAuthors: AuthorStat[];
  recentTags: string[];
}

export async function getRepoStats(cwd: string, days = 30): Promise<RepoStats> {
  return serverFetch("/api/git/stats", { cwd, days });
}

export interface RecentCommit {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  relativeDate: string;
  date: string;
}

export async function getRecentCommits(cwd: string, count = 20): Promise<RecentCommit[]> {
  return serverFetch("/api/git/dashboard/recent-commits", { cwd, count });
}

export interface PrListItem {
  number: number;
  title: string;
  url: string;
  baseBranch: string;
  headBranch: string;
  state: "open" | "closed" | "merged";
  author: string;
  updatedAt: string;
}

export async function getOpenPrs(cwd: string): Promise<PrListItem[]> {
  return serverFetch("/api/git/dashboard/open-prs", { cwd });
}

export async function getMergedPrs(cwd: string, limit = 10): Promise<PrListItem[]> {
  return serverFetch("/api/git/dashboard/merged-prs", { cwd, limit });
}
