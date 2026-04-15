// ---------------------------------------------------------------------------
// Barrel re-export — all git operations split into focused modules.
// server/main.ts imports from "./git" unchanged.
// ---------------------------------------------------------------------------

export { execGit, execGh, type ExecInput } from "./git-exec";
export { getStatus, type GitStatus, type WorkingTreeFile } from "./git-status";
export { getRepoStats, type RepoStats, type DailyCommitStat, type AuthorStat } from "./git-stats";
export {
  listBranches,
  getDefaultBranch,
  getCurrentBranch,
  checkoutBranch,
  createBranch,
  deleteBranch,
  type Branch,
} from "./git-branches";
export {
  getLog,
  stageFiles,
  stageAll,
  unstageFiles,
  createCommit,
  getDiff,
  discardAllChanges,
  getFullDiffPatch,
  getDiffStat,
  type CommitEntry,
} from "./git-commits";
export {
  listOpenPullRequests,
  getPullRequest,
  createPullRequest,
  mergePullRequest,
  type PullRequestSummary,
  type PrListItem,
} from "./git-pr";
export { createGhRepo, getGhDefaultBranch, getForkParent, getGhAuthStatus, listGhRepos, cloneGhRepo, type GhAuthStatus, type GhRepo } from "./git-github";
export { push, pull, fetch, hasOriginRemote, getOriginRepoSlugValue } from "./git-remote";
export { getRecentCommits, getOpenPrs, getMergedPrs, type RecentCommit } from "./git-dashboard";
export { switchToMain, setupRepository, renameMasterToMain, createPreReleaseBranch } from "./git-setup";
export { getPreReleaseAheadCount, getCurrentVersion, createReleasePullRequest } from "./git-release";
export {
  runStackedAction,
  type StackedAction,
  type StackedActionInput,
  type StackedActionResult,
} from "./git-stacked";
export {
  mergePullRequests,
  type MergePullRequestsInput,
  type MergePullRequestsResult,
} from "./git-merge";
export { versionBump, type VersionBumpInput, type VersionBumpResult } from "./git-version";
export { formatTimeAgo } from "./git-utils";
