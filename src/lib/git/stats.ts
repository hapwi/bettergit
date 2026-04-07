/**
 * Git statistics — commit history data for dashboard charts.
 */
import { execGit, execGh } from "./exec";

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
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split("T")[0];

  // Run all queries in parallel
  const [commitLogResult, branchCountResult, authorResult, tagResult] = await Promise.all([
    execGit(cwd, [
      "log",
      `--since=${sinceStr}`,
      "--format=%ai",
      "--no-merges",
    ]),
    execGit(cwd, ["branch", "-a", "--format=%(refname:short)"]),
    execGit(cwd, [
      "shortlog",
      "-sn",
      "--no-merges",
      `--since=${sinceStr}`,
      "HEAD",
    ]),
    execGit(cwd, ["tag", "--sort=-creatordate", "-l"]),
  ]);

  // Parse daily commits
  const dateCounts = new Map<string, number>();
  if (commitLogResult.code === 0) {
    for (const line of commitLogResult.stdout.split("\n").filter(Boolean)) {
      const date = line.trim().slice(0, 10); // YYYY-MM-DD
      dateCounts.set(date, (dateCounts.get(date) ?? 0) + 1);
    }
  }

  // Build daily activity for the past N days (fill gaps with 0)
  const dailyActivity: DailyCommitStat[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];
    dailyActivity.push({
      date: dateStr,
      commits: dateCounts.get(dateStr) ?? 0,
      insertions: 0,
      deletions: 0,
    });
  }

  // Get insertions/deletions for days with commits (batch)
  if (commitLogResult.code === 0) {
    const numstatResult = await execGit(cwd, [
      "log",
      `--since=${sinceStr}`,
      "--format=%ai",
      "--numstat",
      "--no-merges",
    ]);
    if (numstatResult.code === 0) {
      let currentDate = "";
      for (const line of numstatResult.stdout.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Date lines start with a year
        if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
          currentDate = trimmed.slice(0, 10);
        } else {
          const [addedStr, deletedStr] = trimmed.split("\t");
          const added = parseInt(addedStr ?? "0", 10);
          const deleted = parseInt(deletedStr ?? "0", 10);
          if (currentDate && Number.isFinite(added) && Number.isFinite(deleted)) {
            const entry = dailyActivity.find((d) => d.date === currentDate);
            if (entry) {
              entry.insertions += added;
              entry.deletions += deleted;
            }
          }
        }
      }
    }
  }

  const totalCommits = [...dateCounts.values()].reduce((sum, c) => sum + c, 0);

  // Parse branch count
  const totalBranches = branchCountResult.code === 0
    ? branchCountResult.stdout.split("\n").filter(Boolean).length
    : 0;

  // Parse top authors
  const topAuthors: AuthorStat[] = [];
  if (authorResult.code === 0) {
    for (const line of authorResult.stdout.split("\n").filter(Boolean).slice(0, 8)) {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      if (match) {
        topAuthors.push({ name: match[2], commits: parseInt(match[1], 10) });
      }
    }
  }

  // Parse recent tags
  const recentTags = tagResult.code === 0
    ? tagResult.stdout.split("\n").filter(Boolean).slice(0, 5)
    : [];

  return { totalCommits, totalBranches, dailyActivity, topAuthors, recentTags };
}

export interface RecentCommit {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  relativeDate: string;
  date: string;
}

function formatTimeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

export async function getRecentCommits(cwd: string, count = 20): Promise<RecentCommit[]> {
  const result = await execGit(cwd, [
    "log",
    `--max-count=${count}`,
    "--format=%H|%h|%s|%an|%ai",
    "--no-merges",
  ]);
  if (result.code !== 0) return [];
  return result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, shortSha, subject, author, date] = line.split("|");
      return {
        sha: sha ?? "",
        shortSha: shortSha ?? "",
        subject: subject ?? "",
        author: author ?? "",
        relativeDate: formatTimeAgo(date ?? ""),
        date: date ?? "",
      };
    });
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
  const ghResult = await execGh(cwd, [
    "pr", "list", "--state", "open", "--limit", "20",
    "--json", "number,title,url,baseRefName,headRefName,state,author,updatedAt",
  ]);
  if (ghResult.code !== 0) return [];
  try {
    const raw = JSON.parse(ghResult.stdout) as Array<{
      number: number; title: string; url: string;
      baseRefName: string; headRefName: string; state: string;
      author: { login: string }; updatedAt: string;
    }>;
    return raw.map((pr) => ({
      number: pr.number,
      title: pr.title,
      url: pr.url,
      baseBranch: pr.baseRefName,
      headBranch: pr.headRefName,
      state: "open",
      author: pr.author?.login ?? "",
      updatedAt: pr.updatedAt ?? "",
    }));
  } catch { return []; }
}

export async function getMergedPrs(cwd: string, limit = 10): Promise<PrListItem[]> {
  const ghResult = await execGh(cwd, [
    "pr", "list", "--state", "merged", "--limit", String(limit),
    "--json", "number,title,url,baseRefName,headRefName,state,author,updatedAt",
  ]);
  if (ghResult.code !== 0) return [];
  try {
    const raw = JSON.parse(ghResult.stdout) as Array<{
      number: number; title: string; url: string;
      baseRefName: string; headRefName: string; state: string;
      author: { login: string }; updatedAt: string;
    }>;
    return raw.map((pr) => ({
      number: pr.number,
      title: pr.title,
      url: pr.url,
      baseBranch: pr.baseRefName,
      headBranch: pr.headRefName,
      state: "merged",
      author: pr.author?.login ?? "",
      updatedAt: pr.updatedAt ?? "",
    }));
  } catch { return []; }
}
