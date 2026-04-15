export interface DailyCommitStat {
  date: string;
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

export interface RecentCommit {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  relativeDate: string;
  date: string;
}
