import type { ExecInput, ExecResult } from "./exec";
import type { GitStatus, Branch, CommitEntry } from "./git";
import type { PullRequestSummary, PrListItem, GhAuthStatus, GhRepo } from "./github";
import type { CommitMessageInput, CommitMessageResult, PrContentInput, PrContentResult, BranchNameInput, BranchNameResult } from "./ai";
import type { FileEntry, FileContent, ListDirectoryInput, ReadFileInput, WriteFileInput } from "./files";
import type { StackedActionInput, StackedActionResult } from "./stacked";
import type { MergePullRequestsInput, MergePullRequestsResult, VersionBumpInput, VersionBumpResult, SemVer } from "./workflows";
import type { RepoStats, RecentCommit } from "./stats";

export interface ApiRoutes {
  // Health
  "/api/health": { input: void; output: { ok: true } };

  // Git exec
  "/api/git/exec": { input: ExecInput; output: ExecResult };
  "/api/gh/exec": { input: ExecInput; output: ExecResult };

  // Git status & stats
  "/api/git/status": { input: { cwd: string }; output: GitStatus };
  "/api/git/stats": { input: { cwd: string; days?: number }; output: RepoStats };

  // Branches
  "/api/git/branches/list": { input: { cwd: string }; output: Branch[] };
  "/api/git/branches/default": { input: { cwd: string }; output: string };
  "/api/git/branches/current": { input: { cwd: string }; output: string | null };
  "/api/git/branches/checkout": { input: { cwd: string; branch: string }; output: { ok: true } };
  "/api/git/branches/create": { input: { cwd: string; branch: string; startPoint?: string }; output: { ok: true } };
  "/api/git/branches/delete": { input: { cwd: string; branch: string; force?: boolean }; output: { ok: true } };

  // Commits
  "/api/git/commits/log": { input: { cwd: string; count?: number; branch?: string }; output: CommitEntry[] };
  "/api/git/commits/stage-files": { input: { cwd: string; paths: string[] }; output: { ok: true } };
  "/api/git/commits/stage-all": { input: { cwd: string }; output: { ok: true } };
  "/api/git/commits/unstage-files": { input: { cwd: string; paths: string[] }; output: { ok: true } };
  "/api/git/commits/create": { input: { cwd: string; message: string }; output: { sha: string } };
  "/api/git/commits/diff": { input: { cwd: string; staged?: boolean }; output: string };
  "/api/git/commits/discard-all": { input: { cwd: string }; output: { ok: true } };
  "/api/git/commits/full-diff-patch": { input: { cwd: string }; output: string };
  "/api/git/commits/diff-stat": { input: { cwd: string; staged?: boolean }; output: string };

  // GitHub PRs
  "/api/github/prs/open": { input: { cwd: string; headBranch?: string }; output: PullRequestSummary[] };
  "/api/github/pr": { input: { cwd: string; reference: string }; output: PullRequestSummary | null };
  "/api/github/pr/create": { input: { cwd: string; baseBranch: string; title: string; body: string }; output: PullRequestSummary };
  "/api/github/pr/merge": { input: { cwd: string; reference: string; method?: "merge" | "squash" | "rebase"; deleteBranch?: boolean }; output: { ok: true } };

  // GitHub repos
  "/api/github/repo/create": { input: { cwd: string; visibility?: "public" | "private" }; output: { ok: true } };
  "/api/github/repo/default-branch": { input: { cwd: string }; output: string | null };
  "/api/github/repo/fork-parent": { input: { cwd: string }; output: string | null };
  "/api/github/auth-status": { input: { cwd: string }; output: GhAuthStatus };
  "/api/github/repos/list": { input: { limit?: number }; output: GhRepo[] };
  "/api/github/repos/clone": { input: { repo: string; destination: string }; output: { clonedPath: string } };

  // Remote
  "/api/git/remote/push": { input: { cwd: string; setUpstream?: boolean }; output: { ok: true } };
  "/api/git/remote/pull": { input: { cwd: string }; output: { ok: true } };
  "/api/git/remote/fetch": { input: { cwd: string }; output: { ok: true } };
  "/api/git/remote/has-origin": { input: { cwd: string }; output: boolean };
  "/api/git/remote/origin-slug": { input: { cwd: string }; output: string };

  // Setup
  "/api/git/setup/switch-main": { input: { cwd: string }; output: { ok: true } };
  "/api/git/setup/repository": { input: { cwd: string }; output: { committed: boolean } };
  "/api/git/setup/rename-master-main": { input: { cwd: string }; output: { ok: true } };
  "/api/git/setup/pre-release": { input: { cwd: string }; output: { ok: true } };

  // Release
  "/api/git/release/pre-release-ahead": { input: { cwd: string }; output: number };
  "/api/git/release/current-version": { input: { cwd: string }; output: SemVer };
  "/api/git/release/create-pr": { input: { cwd: string }; output: PullRequestSummary };

  // Dashboard
  "/api/git/dashboard/recent-commits": { input: { cwd: string; count?: number }; output: RecentCommit[] };
  "/api/git/dashboard/open-prs": { input: { cwd: string }; output: PrListItem[] };
  "/api/git/dashboard/merged-prs": { input: { cwd: string; limit?: number }; output: PrListItem[] };

  // Stacked actions
  "/api/git/actions/stacked": { input: StackedActionInput; output: StackedActionResult };

  // Merge & version
  "/api/git/merge-prs": { input: MergePullRequestsInput; output: MergePullRequestsResult };
  "/api/git/version-bump": { input: VersionBumpInput; output: VersionBumpResult };

  // AI
  "/api/ai/model": { input: void; output: { model: string } };
  "/api/ai/check-cli": { input: { cli?: string }; output: { available: boolean } };
  "/api/ai/commit-msg": { input: CommitMessageInput; output: CommitMessageResult };
  "/api/ai/pr-content": { input: PrContentInput; output: PrContentResult };
  "/api/ai/branch-name": { input: BranchNameInput; output: BranchNameResult };
  "/api/ai/set-model": { input: { model: string }; output: { ok: true } };

  // Project
  "/api/project/favicon": { input: { cwd: string }; output: { favicon: string | null } };

  // Files
  "/api/files/list": { input: ListDirectoryInput; output: FileEntry[] };
  "/api/files/read": { input: ReadFileInput; output: FileContent };
  "/api/files/write": { input: WriteFileInput; output: { ok: true; mtimeMs: number } };
  "/api/files/create": { input: { cwd: string; relativePath: string }; output: { ok: true } };
  "/api/files/mkdir": { input: { cwd: string; relativePath: string }; output: { ok: true } };
  "/api/files/delete": { input: { cwd: string; relativePath: string }; output: { ok: true } };
  "/api/files/rename": { input: { cwd: string; oldPath: string; newPath: string }; output: { ok: true } };
}
