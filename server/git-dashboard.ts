import { execGit } from "./git-exec";
import { listPrs } from "./git-pr";
import { formatTimeAgo } from "./git-utils";
import { getCurrentVersion } from "./git-release";
import { getDefaultBranch } from "./git-branches";
import { getRepoStats } from "./git-stats";
import type { DashboardData, DashboardOverview, DashboardHotspot, DashboardStaleBranch, RecentCommit } from "../shared/stats";
import type { PrListItem } from "../shared/github";

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

export async function getDashboardOverview(input: {
  cwd: string;
  days?: number;
  hotspotLimit?: number;
  staleDays?: number;
  staleBranchLimit?: number;
}): Promise<DashboardOverview> {
  const { cwd } = input;
  const days = input.days ?? 30;
  const hotspotLimit = input.hotspotLimit ?? 6;
  const staleDays = input.staleDays ?? 14;
  const staleBranchLimit = input.staleBranchLimit ?? 6;
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split("T")[0];

  const [defaultBranch, version, hotspotResult, latestTagResult, branchActivityResult, currentBranchResult] = await Promise.all([
    getDefaultBranch({ cwd }).catch(() => "main"),
    getCurrentVersion({ cwd }).catch(() => ({ major: 0, minor: 0, patch: 0 })),
    execGit({
      cwd,
      args: ["log", `--since=${sinceStr}`, "--format=__COMMIT__%H", "--numstat", "--no-merges", "--find-renames"],
    }),
    execGit({
      cwd,
      args: ["for-each-ref", "--sort=-creatordate", "--count=1", "--format=%(refname:short)|%(creatordate:iso-strict)", "refs/tags"],
    }),
    execGit({
      cwd,
      args: ["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)|%(committerdate:iso-strict)", "refs/heads"],
    }),
    execGit({ cwd, args: ["branch", "--show-current"] }),
  ]);

  const hotspotMap = new Map<string, DashboardHotspot & { commitIds: Set<string> }>();
  if (hotspotResult.code === 0) {
    let currentCommit = "";
    for (const line of hotspotResult.stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("__COMMIT__")) {
        currentCommit = trimmed.replace("__COMMIT__", "");
        continue;
      }

      const [insertionsRaw, deletionsRaw, ...pathParts] = line.split("\t");
      const path = pathParts.join("\t").trim();
      if (!path) continue;

      const insertions = insertionsRaw === "-" ? 0 : parseInt(insertionsRaw ?? "0", 10);
      const deletions = deletionsRaw === "-" ? 0 : parseInt(deletionsRaw ?? "0", 10);
      const existing = hotspotMap.get(path) ?? {
        path,
        commits: 0,
        insertions: 0,
        deletions: 0,
        totalChanges: 0,
        commitIds: new Set<string>(),
      };

      existing.insertions += Number.isFinite(insertions) ? insertions : 0;
      existing.deletions += Number.isFinite(deletions) ? deletions : 0;
      existing.totalChanges = existing.insertions + existing.deletions;
      if (currentCommit) existing.commitIds.add(currentCommit);
      existing.commits = existing.commitIds.size;
      hotspotMap.set(path, existing);
    }
  }

  const hotspots = [...hotspotMap.values()]
    .sort((a, b) => b.totalChanges - a.totalChanges || b.commits - a.commits)
    .slice(0, hotspotLimit)
    .map(({ commitIds: _commitIds, ...hotspot }) => hotspot);

  const latestTagLine = latestTagResult.code === 0 ? latestTagResult.stdout.split("\n").find(Boolean) ?? "" : "";
  const [latestTag, latestTagDate] = latestTagLine.split("|");
  const releaseTag = latestTag?.trim() || null;
  const releaseDate = latestTagDate?.trim() || null;
  let commitsSinceLatestTag = 0;
  if (releaseTag) {
    const commitsSinceTagResult = await execGit({ cwd, args: ["rev-list", "--count", `${releaseTag}..HEAD`] });
    if (commitsSinceTagResult.code === 0) {
      commitsSinceLatestTag = parseInt(commitsSinceTagResult.stdout.trim(), 10) || 0;
    }
  }

  const currentVersion =
    version.major === 0 && version.minor === 0 && version.patch === 0 && !releaseTag
      ? null
      : `${version.major}.${version.minor}.${version.patch}`;

  const mergedBranchResult = await execGit({
    cwd,
    args: ["branch", "--format=%(refname:short)", "--merged", defaultBranch],
  });
  const mergedBranches = new Set(
    mergedBranchResult.code === 0
      ? mergedBranchResult.stdout.split("\n").map((line) => line.trim()).filter(Boolean)
      : [],
  );
  const currentBranch = currentBranchResult.code === 0 ? currentBranchResult.stdout.trim() : "";

  const staleBranchCandidates: DashboardStaleBranch[] = [];
  if (branchActivityResult.code === 0) {
    for (const line of branchActivityResult.stdout.split("\n").filter(Boolean)) {
      const [name, lastCommitDate] = line.split("|");
      const branchName = name?.trim();
      const commitDate = lastCommitDate?.trim();
      if (!branchName || !commitDate) continue;
      if (branchName === defaultBranch) continue;
      if (branchName === currentBranch) continue;

      const daysSinceCommit = Math.floor((Date.now() - new Date(commitDate).getTime()) / (1000 * 60 * 60 * 24));
      if (!Number.isFinite(daysSinceCommit) || daysSinceCommit < staleDays) continue;

      staleBranchCandidates.push({
        name: branchName,
        lastCommitDate: commitDate,
        lastCommitRelative: formatTimeAgo(commitDate),
        daysSinceCommit,
        merged: mergedBranches.has(branchName),
      });
    }
  }

  staleBranchCandidates.sort((a, b) => b.daysSinceCommit - a.daysSinceCommit);

  return {
    hotspots,
    staleBranches: staleBranchCandidates.slice(0, staleBranchLimit),
    staleBranchCount: staleBranchCandidates.length,
    release: {
      currentVersion,
      latestTag: releaseTag,
      latestTagDate: releaseDate,
      latestTagRelative: releaseDate ? formatTimeAgo(releaseDate) : null,
      commitsSinceLatestTag,
    },
  };
}

export async function getDashboardData(input: {
  cwd: string;
  days?: number;
  recentCommitCount?: number;
  mergedPrLimit?: number;
}): Promise<DashboardData> {
  const days = input.days ?? 30;
  const recentCommitCount = input.recentCommitCount ?? 15;
  const mergedPrLimit = input.mergedPrLimit ?? 10;

  const [stats, overview, recentCommits, openPrs, mergedPrs] = await Promise.all([
    getRepoStats({ cwd: input.cwd, days }),
    getDashboardOverview({ cwd: input.cwd, days }),
    getRecentCommits({ cwd: input.cwd, count: recentCommitCount }),
    getOpenPrs({ cwd: input.cwd }),
    getMergedPrs({ cwd: input.cwd, limit: mergedPrLimit }),
  ]);

  return {
    stats,
    overview,
    recentCommits,
    openPrs,
    mergedPrs,
  };
}
