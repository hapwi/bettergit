import { execGit, execGh, readOriginRepoSlug } from "./git-exec";
import type { DailyCommitStat, AuthorStat, RepoStats } from "../shared/stats";

export async function getRepoStats(input: { cwd: string; days?: number }): Promise<RepoStats> {
  const { cwd } = input;
  const days = input.days ?? 30;
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split("T")[0];

  const [commitLogResult, branchCountResult, authorResult, repo] = await Promise.all([
    execGit({ cwd, args: ["log", `--since=${sinceStr}`, "--format=%ai", "--no-merges"] }),
    execGit({ cwd, args: ["branch", "--format=%(refname:short)"] }),
    execGit({ cwd, args: ["shortlog", "-sn", "--no-merges", `--since=${sinceStr}`, "HEAD"] }),
    readOriginRepoSlug(cwd),
  ]);

  const tagResult = repo
    ? await execGh({
        cwd,
        args: [
          "api",
          `repos/${repo}/tags`,
          "--jq",
          `[.[].name] | sort_by(split(".") | map(ltrimstr("v") | tonumber)) | reverse | .[]`,
        ],
      })
    : { code: 1, stdout: "", stderr: "" };

  const dateCounts = new Map<string, number>();
  if (commitLogResult.code === 0) {
    for (const line of commitLogResult.stdout.split("\n").filter(Boolean)) {
      const date = line.trim().slice(0, 10);
      dateCounts.set(date, (dateCounts.get(date) ?? 0) + 1);
    }
  }

  const dailyActivity: DailyCommitStat[] = [];
  const activityByDate = new Map<string, DailyCommitStat>();
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split("T")[0];
    const entry: DailyCommitStat = {
      date: dateStr,
      commits: dateCounts.get(dateStr) ?? 0,
      insertions: 0,
      deletions: 0,
    };
    dailyActivity.push(entry);
    activityByDate.set(dateStr, entry);
  }

  if (commitLogResult.code === 0) {
    const numstatResult = await execGit({
      cwd,
      args: ["log", `--since=${sinceStr}`, "--format=%ai", "--numstat", "--no-merges"],
    });
    if (numstatResult.code === 0) {
      let currentDate = "";
      for (const line of numstatResult.stdout.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
          currentDate = trimmed.slice(0, 10);
          continue;
        }
        const [addedStr, deletedStr] = trimmed.split("\t");
        const added = parseInt(addedStr ?? "0", 10);
        const deleted = parseInt(deletedStr ?? "0", 10);
        const entry = currentDate ? activityByDate.get(currentDate) : undefined;
        if (entry && Number.isFinite(added) && Number.isFinite(deleted)) {
          entry.insertions += added;
          entry.deletions += deleted;
        }
      }
    }
  }

  const topAuthors: AuthorStat[] = [];
  if (authorResult.code === 0) {
    for (const line of authorResult.stdout.split("\n").filter(Boolean).slice(0, 8)) {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      if (match) {
        topAuthors.push({ name: match[2] ?? "", commits: parseInt(match[1] ?? "0", 10) });
      }
    }
  }

  return {
    totalCommits: [...dateCounts.values()].reduce((sum, count) => sum + count, 0),
    totalBranches:
      branchCountResult.code === 0
        ? branchCountResult.stdout.split("\n").filter(Boolean).length
        : 0,
    dailyActivity,
    topAuthors,
    recentTags:
      tagResult.code === 0
        ? tagResult.stdout.split("\n").filter(Boolean).slice(0, 5)
        : [],
  };
}
