import type { PrListItem } from "./github";

export interface DailyCommitStat {
  date: string;
  commits: number;
  insertions: number;
  deletions: number;
}

export interface AuthorStat {
  name: string;
  commits: number;
  login?: string;
  avatarUrl?: string;
}

export interface RepoStats {
  totalCommits: number;
  totalBranches: number;
  dailyActivity: DailyCommitStat[];
  topAuthors: AuthorStat[];
  recentTags: string[];
}

export interface DashboardHotspot {
  path: string;
  commits: number;
  insertions: number;
  deletions: number;
  totalChanges: number;
}

export interface DashboardStaleBranch {
  name: string;
  lastCommitDate: string;
  lastCommitRelative: string;
  daysSinceCommit: number;
  merged: boolean;
}

export interface DashboardReleaseSummary {
  currentVersion: string | null;
  latestTag: string | null;
  latestTagDate: string | null;
  latestTagRelative: string | null;
  commitsSinceLatestTag: number;
}

export interface DashboardOverview {
  hotspots: DashboardHotspot[];
  staleBranches: DashboardStaleBranch[];
  staleBranchCount: number;
  release: DashboardReleaseSummary;
}

export interface RecentCommit {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  relativeDate: string;
  date: string;
}

export interface DashboardData {
  stats: RepoStats;
  overview: DashboardOverview;
  recentCommits: RecentCommit[];
  openPrs: PrListItem[];
  mergedPrs: PrListItem[];
}
