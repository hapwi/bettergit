import { execGit } from "./git-exec";
import { listPrs } from "./git-pr";
import { formatTimeAgo } from "./git-utils";
import type { RecentCommit } from "../shared/stats";

export async function getRecentCommits(input: {
  cwd: string;
  count?: number;
}): Promise<RecentCommit[]> {
  const count = input.count ?? 20;
  const result = await execGit({
    cwd: input.cwd,
    args: ["log", `--max-count=${count}`, "--format=%H|%h|%s|%an|%ai", "--no-merges"],
  });
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

export async function getOpenPrs(input: { cwd: string }): Promise<PrListItem[]> {
  return listPrs(input.cwd, "open", 20);
}

export async function getMergedPrs(input: {
  cwd: string;
  limit?: number;
}): Promise<PrListItem[]> {
  return listPrs(input.cwd, "merged", input.limit ?? 10);
}
