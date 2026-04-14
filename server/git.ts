import fs from "node:fs/promises";
import path from "node:path";
import { runProcess, type ExecResult } from "./env";
import * as ai from "./ai";

// ---------------------------------------------------------------------------
// Low-level exec
// ---------------------------------------------------------------------------

export interface ExecInput {
  cwd: string;
  args: string[];
  timeoutMs?: number;
}

export async function execGit(input: ExecInput): Promise<ExecResult> {
  return runProcess("git", input.args, input.cwd, input.timeoutMs);
}

export async function execGh(input: ExecInput): Promise<ExecResult> {
  return runProcess("gh", input.args, input.cwd, input.timeoutMs);
}

async function readOriginRepoSlug(cwd: string): Promise<string> {
  const result = await execGit({ cwd, args: ["remote", "get-url", "origin"] });
  if (result.code !== 0) return "";
  const match = result.stdout.trim().match(/github\.com[/:]([^/]+\/[^/.]+)/);
  return match ? match[1] : "";
}

export interface WorkingTreeFile {
  path: string;
  insertions: number;
  deletions: number;
}

export interface GitStatus {
  branch: string | null;
  isDetached: boolean;
  isRepo: boolean;
  hasCommits: boolean;
  hasOriginRemote: boolean;
  hasWorkingTreeChanges: boolean;
  workingTree: {
    files: WorkingTreeFile[];
    insertions: number;
    deletions: number;
  };
  hasUpstream: boolean;
  aheadCount: number;
  behindCount: number;
  pr: null;
}

export async function getStatus(input: { cwd: string }): Promise<GitStatus> {
  const { cwd } = input;
  const result = await execGit({
    cwd,
    args: ["status", "--porcelain=v2", "--branch", "--untracked-files=normal"],
  });

  if (result.code !== 0) {
    return {
      branch: null,
      isDetached: false,
      isRepo: false,
      hasCommits: false,
      hasOriginRemote: false,
      hasWorkingTreeChanges: false,
      workingTree: { files: [], insertions: 0, deletions: 0 },
      hasUpstream: false,
      aheadCount: 0,
      behindCount: 0,
      pr: null,
    };
  }

  const lines = result.stdout.split("\n").filter(Boolean);
  let branch: string | null = null;
  let isDetached = false;
  let aheadCount = 0;
  let behindCount = 0;
  let hasUpstream = false;
  const changedPaths: string[] = [];

  for (const line of lines) {
    if (line.startsWith("# branch.head ")) {
      branch = line.slice("# branch.head ".length);
      if (branch === "(detached)") {
        branch = null;
        isDetached = true;
      }
    } else if (line.startsWith("# branch.upstream ")) {
      hasUpstream = true;
    } else if (line.startsWith("# branch.ab ")) {
      const match = line.match(/^# branch\.ab \+(\d+) -(\d+)$/);
      if (match) {
        aheadCount = parseInt(match[1], 10);
        behindCount = parseInt(match[2], 10);
      }
    } else if (line.startsWith("1 ")) {
      const parts = line.split(" ");
      if (parts.length >= 9) {
        const xy = parts[1] ?? "";
        const sub = parts[2] ?? "";
        const headMode = parts[3] ?? "";
        const indexMode = parts[4] ?? "";
        const worktreeMode = parts[5] ?? "";
        const filePath = parts.slice(8).join(" ");
        const isGitLink =
          headMode === "160000" &&
          indexMode === "160000" &&
          worktreeMode === "160000";
        const isNestedRepoDirtyOnly =
          isGitLink &&
          xy.startsWith(".") &&
          sub.startsWith("S.") &&
          (sub[2] !== "." || sub[3] !== ".");

        if (filePath && !isNestedRepoDirtyOnly) changedPaths.push(filePath);
      }
    } else if (line.startsWith("2 ")) {
      const tabIdx = line.indexOf("\t");
      if (tabIdx >= 0) {
        const parts = line.slice(tabIdx + 1).split("\t");
        const filePath = parts[0];
        if (filePath) changedPaths.push(filePath);
      }
    } else if (line.startsWith("? ")) {
      changedPaths.push(line.slice(2));
    }
  }

  const [headResult, remoteResult] = await Promise.all([
    execGit({ cwd, args: ["rev-parse", "--verify", "HEAD"] }),
    execGit({ cwd, args: ["remote"] }),
  ]);
  const hasCommits = headResult.code === 0;
  const hasOriginRemote = remoteResult.stdout.split("\n").some((remote) => remote.trim() === "origin");

  if (!hasUpstream && branch) {
    const defaultBranches = ["main", "master"];
    for (const base of defaultBranches) {
      if (base === branch) continue;
      const countResult = await execGit({ cwd, args: ["rev-list", "--count", `${base}..${branch}`] });
      if (countResult.code === 0) {
        const count = parseInt(countResult.stdout.trim(), 10);
        if (count > 0) aheadCount = count;
        break;
      }
    }
  }

  let files: WorkingTreeFile[] = [];
  if (changedPaths.length > 0) {
    const numstatResult = await execGit({ cwd, args: ["diff", "--numstat", "HEAD"] });
    const untrackedCandidates = changedPaths.filter((p) => !numstatResult.stdout.includes(p));
    const untrackedResult =
      untrackedCandidates.length > 0
        ? await execGit({ cwd, args: ["diff", "--numstat", "--no-index", "/dev/null", ...untrackedCandidates] })
        : { code: 0, stdout: "", stderr: "" };

    const parseNumstat = (stdout: string): WorkingTreeFile[] =>
      stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [addedRaw, deletedRaw, ...pathParts] = line.split("\t");
          const filePath = pathParts.join("\t").trim();
          if (!filePath) return null;
          const insertions = parseInt(addedRaw ?? "0", 10);
          const deletions = parseInt(deletedRaw ?? "0", 10);
          return {
            path: filePath,
            insertions: Number.isFinite(insertions) ? insertions : 0,
            deletions: Number.isFinite(deletions) ? deletions : 0,
          };
        })
        .filter((file): file is WorkingTreeFile => file !== null);

    const tracked = parseNumstat(numstatResult.stdout);
    const untracked = parseNumstat(untrackedResult.stdout);
    const trackedPaths = new Set(tracked.map((file) => file.path));
    files = [...tracked, ...untracked.filter((file) => !trackedPaths.has(file.path))];

    const filePaths = new Set(files.map((file) => file.path));
    for (const filePath of changedPaths) {
      if (!filePaths.has(filePath)) {
        files.push({ path: filePath, insertions: 0, deletions: 0 });
      }
    }
  }

  return {
    branch,
    isDetached,
    isRepo: true,
    hasCommits,
    hasOriginRemote,
    hasWorkingTreeChanges: changedPaths.length > 0,
    workingTree: {
      files,
      insertions: files.reduce((sum, file) => sum + file.insertions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    },
    hasUpstream,
    aheadCount,
    behindCount,
    pr: null,
  };
}

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

export interface Branch {
  name: string;
  current: boolean;
  isRemote: boolean;
  isDefault: boolean;
  upstream: string | null;
}

export async function listBranches(input: { cwd: string }): Promise<Branch[]> {
  const { cwd } = input;
  const [localResult, remoteResult] = await Promise.all([
    execGit({ cwd, args: ["branch", "--format=%(HEAD)|%(refname:short)|%(upstream:short)"] }),
    execGit({ cwd, args: ["branch", "-r", "--format=%(refname:short)", "--list", "origin/*"] }),
  ]);

  requireOk(localResult, "list branches");
  const defaultBranch = await getDefaultBranch({ cwd });
  const branches: Branch[] = [];

  for (const line of localResult.stdout.split("\n").filter(Boolean)) {
    const [head, name, upstream] = line.split("|");
    if (!name) continue;
    branches.push({
      name,
      current: head === "*",
      isRemote: false,
      isDefault: name === defaultBranch,
      upstream: upstream || null,
    });
  }

  const localNames = new Set(branches.map((branch) => branch.name));
  if (remoteResult.code === 0) {
    for (const line of remoteResult.stdout.split("\n").filter(Boolean)) {
      const name = line.trim();
      if (!name || name.includes("/HEAD")) continue;
      const localName = name.replace(/^origin\//, "");
      if (localNames.has(localName)) continue;
      branches.push({
        name,
        current: false,
        isRemote: true,
        isDefault: localName === defaultBranch,
        upstream: null,
      });
    }
  }

  return branches;
}

export async function getDefaultBranch(input: { cwd: string }): Promise<string> {
  const { cwd } = input;
  const result = await execGit({
    cwd,
    args: ["symbolic-ref", "refs/remotes/origin/HEAD", "--short"],
  });
  if (result.code === 0) {
    return result.stdout.trim().replace(/^origin\//, "");
  }

  const branchResult = await execGit({ cwd, args: ["branch", "--list", "main", "master"] });
  const branches = branchResult.stdout
    .trim()
    .split("\n")
    .map((branch) => branch.trim().replace(/^\* /, ""))
    .filter(Boolean);

  return branches.includes("main") ? "main" : branches[0] ?? "main";
}

export async function getCurrentBranch(input: { cwd: string }): Promise<string | null> {
  const result = await execGit({ cwd: input.cwd, args: ["branch", "--show-current"] });
  if (result.code !== 0) return null;
  const branch = result.stdout.trim();
  return branch || null;
}

export async function checkoutBranch(input: { cwd: string; branch: string }): Promise<{ ok: true }> {
  requireOk(await execGit({ cwd: input.cwd, args: ["checkout", input.branch] }), `checkout ${input.branch}`);
  return { ok: true };
}

export async function createBranch(input: {
  cwd: string;
  branch: string;
  startPoint?: string;
}): Promise<{ ok: true }> {
  const args = ["checkout", "-b", input.branch];
  if (input.startPoint) args.push(input.startPoint);
  requireOk(await execGit({ cwd: input.cwd, args }), `create branch ${input.branch}`);
  return { ok: true };
}

export async function deleteBranch(input: {
  cwd: string;
  branch: string;
  force?: boolean;
}): Promise<{ ok: true }> {
  const { cwd, branch, force = false } = input;

  if (branch.startsWith("origin/")) {
    const remoteBranch = branch.replace(/^origin\//, "");
    await execGit({ cwd, args: ["push", "origin", "--delete", remoteBranch] });
    await execGit({ cwd, args: ["fetch", "--prune", "origin"] });
    return { ok: true };
  }

  requireOk(
    await execGit({ cwd, args: ["branch", force ? "-D" : "-d", "--", branch] }),
    `delete branch ${branch}`,
  );

  const remoteCheck = await execGit({ cwd, args: ["ls-remote", "--heads", "origin", branch] });
  if (remoteCheck.code === 0 && remoteCheck.stdout.trim()) {
    await execGit({ cwd, args: ["push", "origin", "--delete", branch] });
  }

  await execGit({ cwd, args: ["fetch", "--prune", "origin"] });
  return { ok: true };
}

export interface CommitEntry {
  sha: string;
  shortSha: string;
  subject: string;
  body: string;
  author: string;
  date: string;
  relativeDate: string;
}

export async function getLog(input: {
  cwd: string;
  count?: number;
  branch?: string;
}): Promise<CommitEntry[]> {
  const { cwd, branch } = input;
  const count = input.count ?? 50;
  const args = [
    "log",
    `--max-count=${count}`,
    "--format=%H|%h|%s|%b|%an|%ai|%ar",
    "--no-merges",
  ];
  if (branch) args.push(branch);

  const stdout = requireOk(await execGit({ cwd, args }), "git log");
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, shortSha, subject, body, author, date, relativeDate] = line.split("|");
      return {
        sha: sha ?? "",
        shortSha: shortSha ?? "",
        subject: subject ?? "",
        body: body ?? "",
        author: author ?? "",
        date: date ?? "",
        relativeDate: relativeDate ?? "",
      };
    });
}

export async function stageFiles(input: {
  cwd: string;
  paths: string[];
}): Promise<{ ok: true }> {
  if (input.paths.length === 0) return { ok: true };
  requireOk(await execGit({ cwd: input.cwd, args: ["add", ...input.paths] }), "stage files");
  return { ok: true };
}

export async function stageAll(input: { cwd: string }): Promise<{ ok: true }> {
  requireOk(await execGit({ cwd: input.cwd, args: ["add", "-A"] }), "stage all");
  return { ok: true };
}

export async function unstageFiles(input: {
  cwd: string;
  paths: string[];
}): Promise<{ ok: true }> {
  if (input.paths.length === 0) return { ok: true };
  requireOk(
    await execGit({ cwd: input.cwd, args: ["reset", "HEAD", "--", ...input.paths] }),
    "unstage files",
  );
  return { ok: true };
}

export async function createCommit(input: {
  cwd: string;
  message: string;
}): Promise<{ sha: string }> {
  requireOk(await execGit({ cwd: input.cwd, args: ["commit", "-m", input.message] }), "commit");
  const shaResult = await execGit({ cwd: input.cwd, args: ["rev-parse", "HEAD"] });
  return { sha: shaResult.stdout.trim() };
}

export async function getDiff(input: {
  cwd: string;
  staged?: boolean;
}): Promise<string> {
  const args = input.staged ? ["diff", "--cached"] : ["diff"];
  const result = await execGit({ cwd: input.cwd, args });
  return result.stdout;
}

export async function discardAllChanges(input: { cwd: string }): Promise<{ ok: true }> {
  const { cwd } = input;
  await execGit({ cwd, args: ["reset", "HEAD"] });
  requireOk(await execGit({ cwd, args: ["checkout", "--", "."] }), "discard tracked changes");
  requireOk(await execGit({ cwd, args: ["clean", "-fd"] }), "discard untracked files");
  return { ok: true };
}

export async function getFullDiffPatch(input: { cwd: string }): Promise<string> {
  const { cwd } = input;
  const trackedResult = await execGit({ cwd, args: ["diff", "HEAD"] });
  const trackedPatch = trackedResult.stdout;

  const untrackedResult = await execGit({
    cwd,
    args: ["ls-files", "--others", "--exclude-standard"],
  });
  const untrackedFiles = untrackedResult.stdout.trim().split("\n").filter(Boolean);

  const untrackedPatches: string[] = [];
  for (const file of untrackedFiles) {
    const result = await execGit({ cwd, args: ["diff", "--no-index", "/dev/null", file] });
    if (result.stdout) untrackedPatches.push(result.stdout);
  }

  return [trackedPatch, ...untrackedPatches].filter(Boolean).join("\n");
}

export async function getDiffStat(input: {
  cwd: string;
  staged?: boolean;
}): Promise<string> {
  const args = input.staged ? ["diff", "--cached", "--stat"] : ["diff", "--stat"];
  const result = await execGit({ cwd: input.cwd, args });
  return result.stdout;
}

export interface PullRequestSummary {
  number: number;
  title: string;
  url: string;
  baseBranch: string;
  headBranch: string;
  state: "open" | "closed" | "merged";
}

export async function listOpenPullRequests(input: {
  cwd: string;
  headBranch?: string;
}): Promise<PullRequestSummary[]> {
  const { cwd } = input;
  const repo = await readOriginRepoSlug(cwd);
  const args = [
    "pr",
    "list",
    "--state",
    "open",
    "--json",
    "number,title,url,baseRefName,headRefName,state",
    "--limit",
    "20",
  ];
  if (repo) args.push("--repo", repo);
  if (input.headBranch) args.push("--head", input.headBranch);

  const result = await execGh({ cwd, args });
  if (result.code !== 0) return [];

  try {
    const raw = JSON.parse(result.stdout) as Array<{
      number: number;
      title: string;
      url: string;
      baseRefName: string;
      headRefName: string;
      state: string;
    }>;
    return raw.map((pr) => ({
      number: pr.number,
      title: pr.title,
      url: pr.url,
      baseBranch: pr.baseRefName,
      headBranch: pr.headRefName,
      state: pr.state === "MERGED" ? "merged" : pr.state === "CLOSED" ? "closed" : "open",
    }));
  } catch {
    return [];
  }
}

export async function getPullRequest(input: {
  cwd: string;
  reference: string;
}): Promise<PullRequestSummary | null> {
  const result = await execGh({
    cwd: input.cwd,
    args: ["pr", "view", input.reference, "--json", "number,title,url,baseRefName,headRefName,state"],
  });
  if (result.code !== 0) return null;

  try {
    const pr = JSON.parse(result.stdout) as {
      number: number;
      title: string;
      url: string;
      baseRefName: string;
      headRefName: string;
      state: string;
    };
    return {
      number: pr.number,
      title: pr.title,
      url: pr.url,
      baseBranch: pr.baseRefName,
      headBranch: pr.headRefName,
      state: pr.state === "MERGED" ? "merged" : pr.state === "CLOSED" ? "closed" : "open",
    };
  } catch {
    return null;
  }
}

export async function createPullRequest(input: {
  cwd: string;
  baseBranch: string;
  title: string;
  body: string;
}): Promise<PullRequestSummary> {
  const stdout = requireOk(
    await execGh({
      cwd: input.cwd,
      args: ["pr", "create", "--base", input.baseBranch, "--title", input.title, "--body", input.body],
    }),
    "create PR",
  );

  const url = stdout.trim();
  const viewResult = await execGh({
    cwd: input.cwd,
    args: ["pr", "view", url, "--json", "number,title,url,baseRefName,headRefName,state"],
  });

  if (viewResult.code === 0) {
    const pr = JSON.parse(viewResult.stdout) as {
      number: number;
      title: string;
      url: string;
      baseRefName: string;
      headRefName: string;
      state: string;
    };
    return {
      number: pr.number,
      title: pr.title,
      url: pr.url,
      baseBranch: pr.baseRefName,
      headBranch: pr.headRefName,
      state: "open",
    };
  }

  const numberMatch = url.match(/\/pull\/(\d+)/);
  return {
    number: numberMatch ? parseInt(numberMatch[1], 10) : 0,
    title: input.title,
    url,
    baseBranch: input.baseBranch,
    headBranch: "",
    state: "open",
  };
}

export async function mergePullRequest(input: {
  cwd: string;
  reference: string;
  method?: "merge" | "squash" | "rebase";
  deleteBranch?: boolean;
}): Promise<{ ok: true }> {
  const method = input.method ?? "squash";
  const deleteBranch = input.deleteBranch ?? true;
  const args = ["pr", "merge", input.reference, `--${method}`];
  if (deleteBranch) args.push("--delete-branch");
  requireOk(await execGh({ cwd: input.cwd, args }), `merge PR ${input.reference}`);
  return { ok: true };
}

export async function createGhRepo(input: {
  cwd: string;
  visibility?: "public" | "private";
}): Promise<{ ok: true }> {
  const visibility = input.visibility ?? "private";
  requireOk(
    await execGh({
      cwd: input.cwd,
      args: ["repo", "create", "--source", ".", `--${visibility}`, "--push"],
    }),
    "create GitHub repo",
  );
  return { ok: true };
}

export async function getGhDefaultBranch(input: {
  cwd: string;
}): Promise<string | null> {
  const result = await execGh({
    cwd: input.cwd,
    args: ["repo", "view", "--json", "defaultBranchRef"],
  });
  if (result.code !== 0) return null;
  try {
    const data = JSON.parse(result.stdout) as { defaultBranchRef?: { name?: string } };
    return data.defaultBranchRef?.name ?? null;
  } catch {
    return null;
  }
}

export async function push(input: {
  cwd: string;
  setUpstream?: boolean;
}): Promise<{ ok: true }> {
  const args = ["push"];
  if (input.setUpstream) {
    const branch = (await execGit({ cwd: input.cwd, args: ["branch", "--show-current"] })).stdout.trim();
    args.push("-u", "origin", branch);
  }
  requireOk(await execGit({ cwd: input.cwd, args }), "push");
  return { ok: true };
}

export async function pull(input: { cwd: string }): Promise<{ ok: true }> {
  requireOk(await execGit({ cwd: input.cwd, args: ["pull", "--ff-only"] }), "pull");
  return { ok: true };
}

export async function fetch(input: { cwd: string }): Promise<{ ok: true }> {
  requireOk(await execGit({ cwd: input.cwd, args: ["fetch", "--prune"] }), "fetch");
  return { ok: true };
}

export async function hasOriginRemote(input: { cwd: string }): Promise<boolean> {
  const result = await execGit({ cwd: input.cwd, args: ["remote"] });
  return result.stdout.split("\n").some((remote) => remote.trim() === "origin");
}

export async function getOriginRepoSlugValue(input: { cwd: string }): Promise<string> {
  return readOriginRepoSlug(input.cwd);
}

export interface RecentCommit {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  relativeDate: string;
  date: string;
}

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

async function listPrs(
  cwd: string,
  state: "open" | "merged",
  limit: number,
): Promise<PrListItem[]> {
  const repo = await readOriginRepoSlug(cwd);
  const args = [
    "pr", "list", "--state", state, "--limit", String(limit),
    "--json", "number,title,url,baseRefName,headRefName,state,author,updatedAt",
  ];
  if (repo) args.push("--repo", repo);
  const ghResult = await execGh({ cwd, args });
  if (ghResult.code !== 0) return [];
  try {
    const raw = JSON.parse(ghResult.stdout) as Array<{
      number: number;
      title: string;
      url: string;
      baseRefName: string;
      headRefName: string;
      state: string;
      author: { login: string };
      updatedAt: string;
    }>;
    return raw.map((pr) => ({
      number: pr.number,
      title: pr.title,
      url: pr.url,
      baseBranch: pr.baseRefName,
      headBranch: pr.headRefName,
      state,
      author: pr.author?.login ?? "",
      updatedAt: pr.updatedAt ?? "",
    }));
  } catch {
    return [];
  }
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

export async function getForkParent(input: { cwd: string }): Promise<string | null> {
  const repo = await readOriginRepoSlug(input.cwd);
  if (!repo) return null;
  const result = await execGh({
    cwd: input.cwd,
    args: ["repo", "view", repo, "--json", "isFork,parent"],
  });
  if (result.code !== 0) return null;
  try {
    const data = JSON.parse(result.stdout) as {
      isFork: boolean;
      parent?: { name: string; owner: { login: string } };
    };
    if (!data.isFork || !data.parent) return null;
    return data.parent.owner.login + "/" + data.parent.name;
  } catch {
    return null;
  }
}

export interface GhAuthStatus {
  connected: boolean;
  detail: string;
}

export async function getGhAuthStatus(input: { cwd: string }): Promise<GhAuthStatus> {
  try {
    const result = await execGh({ cwd: input.cwd, args: ["auth", "status"] });
    const output = result.stdout + result.stderr;
    if (result.code === 0 || output.includes("Logged in")) {
      const match = output.match(/Logged in to (.+?) account (.+?)[\s(]/);
      return {
        connected: true,
        detail: match ? match[2] + " on " + match[1] : "Authenticated",
      };
    }
    return {
      connected: false,
      detail: "Run: gh auth login",
    };
  } catch {
    return {
      connected: false,
      detail: "gh CLI not found",
    };
  }
}

function parseSemVer(tag: string): { major: number; minor: number; patch: number } | null {
  const match = tag.replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

async function ensureMainBranchInternal(cwd: string): Promise<void> {
  const status = await getStatus({ cwd });
  const mainExists = (await execGit({
    cwd,
    args: ["show-ref", "--verify", "--quiet", "refs/heads/main"],
  })).code === 0;

  if (mainExists) {
    requireOk(await execGit({ cwd, args: ["switch", "main"] }), "switch main");
    return;
  }

  if (status.branch === "master") {
    requireOk(await execGit({ cwd, args: ["branch", "-m", "master", "main"] }), "rename master to main");
    return;
  }

  if (status.isDetached) {
    if (status.hasCommits) {
      requireOk(await execGit({ cwd, args: ["switch", "-c", "main"] }), "create main branch");
    } else {
      requireOk(await execGit({ cwd, args: ["checkout", "--orphan", "main"] }), "create orphan main");
    }
    return;
  }

  if (!status.branch) {
    requireOk(await execGit({ cwd, args: ["checkout", "--orphan", "main"] }), "create orphan main");
    return;
  }

  if (!status.hasCommits) {
    requireOk(await execGit({ cwd, args: ["branch", "-m", status.branch, "main"] }), "rename branch to main");
  }
}

export async function switchToMain(input: { cwd: string }): Promise<{ ok: true }> {
  await ensureMainBranchInternal(input.cwd);
  return { ok: true };
}

export async function setupRepository(input: {
  cwd: string;
}): Promise<{ committed: boolean }> {
  const { cwd } = input;
  const statusBefore = await getStatus({ cwd });
  await ensureMainBranchInternal(cwd);

  if (statusBefore.hasWorkingTreeChanges) {
    requireOk(await execGit({ cwd, args: ["add", "-A"] }), "stage initial commit");
    requireOk(await execGit({ cwd, args: ["commit", "-m", "Initial commit"] }), "initial commit");
    return { committed: true };
  }

  return { committed: false };
}

export async function renameMasterToMain(input: { cwd: string }): Promise<{ ok: true }> {
  const { cwd } = input;
  requireOk(await execGit({ cwd, args: ["branch", "-m", "master", "main"] }), "rename master to main");
  requireOk(await execGit({ cwd, args: ["push", "-u", "origin", "main"] }), "push main");
  requireOk(await execGit({ cwd, args: ["remote", "set-head", "origin", "main"] }), "set origin head");
  requireOk(await execGit({ cwd, args: ["push", "origin", "--delete", "master"] }), "delete remote master");
  return { ok: true };
}

export async function createPreReleaseBranch(input: { cwd: string }): Promise<{ ok: true }> {
  const { cwd } = input;
  requireOk(await execGit({ cwd, args: ["checkout", "-b", "pre-release"] }), "create pre-release");
  if (await hasOriginRemote({ cwd })) {
    requireOk(await execGit({ cwd, args: ["push", "-u", "origin", "pre-release"] }), "push pre-release");
  }
  return { ok: true };
}

export async function getPreReleaseAheadCount(input: { cwd: string }): Promise<number> {
  const { cwd } = input;
  await execGit({ cwd, args: ["fetch", "--quiet", "origin"] });
  const branches = await listBranches({ cwd });
  const mainExists = branches.some((branch) => branch.name === "main" || branch.name === "origin/main");
  const target = mainExists ? "origin/main" : "origin/master";
  const result = await execGit({ cwd, args: ["rev-list", "--count", target + "..pre-release"] });
  if (result.code !== 0) return 0;
  return parseInt(result.stdout.trim(), 10);
}

export async function getCurrentVersion(input: {
  cwd: string;
}): Promise<{ major: number; minor: number; patch: number }> {
  const { cwd } = input;
  await execGit({ cwd, args: ["fetch", "--tags", "--quiet", "origin"] }).catch(() => undefined);
  const result = await execGit({ cwd, args: ["tag", "--sort=-v:refname", "-l", "v*"] });
  const tags = result.stdout.trim().split("\n").filter(Boolean);
  for (const tag of tags) {
    const parsed = parseSemVer(tag);
    if (parsed) return parsed;
  }

  const pkgResult = await execGit({ cwd, args: ["show", "HEAD:package.json"] });
  if (pkgResult.code === 0) {
    try {
      const pkg = JSON.parse(pkgResult.stdout) as { version?: string };
      if (pkg.version) {
        const parsed = parseSemVer(pkg.version);
        if (parsed) return parsed;
      }
    } catch {
      // ignore invalid JSON
    }
  }

  return { major: 0, minor: 0, patch: 0 };
}

export async function createReleasePullRequest(input: {
  cwd: string;
}): Promise<PullRequestSummary> {
  const { cwd } = input;
  const branches = await listBranches({ cwd });
  const mainExists = branches.some((branch) => branch.name === "main" || branch.name === "origin/main");
  const targetBranch = mainExists ? "main" : "master";

  const rangeCtx = await getRangeContext(cwd, targetBranch);
  let prTitle = "Release: pre-release -> " + targetBranch;
  let prBody = "";

  try {
    const generated = await ai.generatePrContent({
      cwd,
      baseBranch: targetBranch,
      headBranch: "pre-release",
      commitSummary: rangeCtx.commitSummary,
      diffSummary: rangeCtx.diffSummary,
      diffPatch: rangeCtx.diffPatch,
    });
    prTitle = generated.title;
    prBody = generated.body;
  } catch {
    // fallback title/body
  }

  return createPullRequest({
    cwd,
    baseBranch: targetBranch,
    title: prTitle,
    body: prBody,
  });
}

export type StackedAction = "commit" | "commit_push" | "commit_push_pr";

export interface StackedActionInput {
  cwd: string;
  action: StackedAction;
  commitMessage?: string;
  featureBranch?: boolean;
  filePaths?: string[];
}

export interface StackedActionResult {
  action: StackedAction;
  branch: { status: "created" | "skipped_not_requested"; name?: string };
  commit: { status: "created" | "skipped_no_changes"; commitSha?: string; subject?: string };
  push: {
    status: "pushed" | "skipped_not_requested" | "skipped_up_to_date";
    branch?: string;
    setUpstream?: boolean;
  };
  pr: {
    status: "created" | "opened_existing" | "skipped_not_requested";
    url?: string;
    number?: number;
    baseBranch?: string;
    headBranch?: string;
    title?: string;
  };
}

function sanitizeBranchFragment(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/"/g, "")
    .replace(/`/g, "")
    .replace(/^[./\s_-]+|[./\s_-]+$/g, "");

  const branchFragment = normalized
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/-+/g, "-")
    .replace(/^[./_-]+|[./_-]+$/g, "")
    .slice(0, 64)
    .replace(/[./_-]+$/g, "");

  return branchFragment.length > 0 ? branchFragment : "update";
}

function sanitizeFeatureBranchName(raw: string): string {
  const sanitized = sanitizeBranchFragment(raw);
  const prefixes = ["feature/", "fix/", "bug/", "chore/", "refactor/", "hotfix/", "docs/", "test/", "style/"];
  if (prefixes.some((prefix) => sanitized.startsWith(prefix))) return sanitized;
  return "feature/" + sanitized;
}

function resolveAutoFeatureBranchName(
  existingBranchNames: readonly string[],
  preferredBranch?: string,
): string {
  const preferred = preferredBranch?.trim();
  const resolvedBase = sanitizeFeatureBranchName(
    preferred && preferred.length > 0 ? preferred : "feature/update",
  );
  const existingNames = new Set(existingBranchNames.map((branch) => branch.toLowerCase()));
  if (!existingNames.has(resolvedBase)) return resolvedBase;

  let suffix = 2;
  while (existingNames.has(resolvedBase + "-" + suffix)) suffix += 1;
  return resolvedBase + "-" + suffix;
}

async function getStagedSummary(cwd: string): Promise<string> {
  return (await execGit({ cwd, args: ["diff", "--cached", "--stat"] })).stdout;
}

async function getStagedPatch(cwd: string): Promise<string> {
  return (await execGit({ cwd, args: ["diff", "--cached"] })).stdout.slice(0, 50_000);
}

async function getRangeContext(
  cwd: string,
  baseBranch: string,
): Promise<{ commitSummary: string; diffSummary: string; diffPatch: string }> {
  const [commitResult, diffStatResult, diffPatchResult] = await Promise.all([
    execGit({ cwd, args: ["log", baseBranch + "..HEAD", "--oneline", "--no-merges"] }),
    execGit({ cwd, args: ["diff", baseBranch + "...HEAD", "--stat"] }),
    execGit({ cwd, args: ["diff", baseBranch + "...HEAD"] }),
  ]);
  return {
    commitSummary: commitResult.stdout.slice(0, 20_000),
    diffSummary: diffStatResult.stdout.slice(0, 20_000),
    diffPatch: diffPatchResult.stdout.slice(0, 60_000),
  };
}

async function listLocalBranchNames(cwd: string): Promise<string[]> {
  const result = await execGit({ cwd, args: ["branch", "--format=%(refname:short)"] });
  return result.stdout.trim().split("\n").filter(Boolean);
}

export async function runStackedAction(input: StackedActionInput): Promise<StackedActionResult> {
  const { cwd, action, filePaths } = input;
  let { commitMessage } = input;

  const result: StackedActionResult = {
    action,
    branch: { status: "skipped_not_requested" },
    commit: { status: "skipped_no_changes" },
    push: { status: "skipped_not_requested" },
    pr: { status: "skipped_not_requested" },
  };

  let currentBranch = await getCurrentBranch({ cwd });
  const parentBranch = currentBranch;

  if (input.featureBranch) {
    if (filePaths && filePaths.length > 0) {
      requireOk(await execGit({ cwd, args: ["add", "--", ...filePaths] }), "stage files");
    } else {
      requireOk(await execGit({ cwd, args: ["add", "-A"] }), "stage all");
    }

    const stagedSummary = await getStagedSummary(cwd);
    const stagedPatch = await getStagedPatch(cwd);

    let branchName: string;
    try {
      const generated = await ai.generateCommitMessage({
        cwd,
        branch: currentBranch,
        stagedSummary,
        stagedPatch,
        includeBranch: true,
      });
      const generatedMessage = generated.subject + (generated.body ? "\n\n" + generated.body : "");
      commitMessage = commitMessage || generatedMessage;
      branchName = generated.branch
        ? sanitizeFeatureBranchName(generated.branch)
        : "feature/update";
    } catch {
      branchName = "feature/update";
    }

    const existingBranches = await listLocalBranchNames(cwd);
    branchName = resolveAutoFeatureBranchName(existingBranches, branchName);

    requireOk(
      await execGit({ cwd, args: ["checkout", "-b", branchName] }),
      "create branch " + branchName,
    );
    if (parentBranch) {
      await execGit({
        cwd,
        args: ["config", "branch." + branchName + ".gh-merge-base", parentBranch],
      });
    }
    currentBranch = branchName;
    result.branch = { status: "created", name: branchName };
  }

  if (!input.featureBranch) {
    if (filePaths && filePaths.length > 0) {
      requireOk(await execGit({ cwd, args: ["add", "--", ...filePaths] }), "stage files");
    } else {
      requireOk(await execGit({ cwd, args: ["add", "-A"] }), "stage all");
    }
  }

  const stagedCheck = await execGit({ cwd, args: ["diff", "--cached", "--quiet"] });
  const hasStagedChanges = stagedCheck.code !== 0;

  if (hasStagedChanges) {
    if (!commitMessage) {
      const stagedSummary = await getStagedSummary(cwd);
      const stagedPatch = await getStagedPatch(cwd);
      try {
        const generated = await ai.generateCommitMessage({
          cwd,
          branch: currentBranch,
          stagedSummary,
          stagedPatch,
        });
        commitMessage = generated.subject + (generated.body ? "\n\n" + generated.body : "");
      } catch {
        commitMessage = "Update project files";
      }
    }

    requireOk(await execGit({ cwd, args: ["commit", "-m", commitMessage] }), "commit");
    const shaResult = await execGit({ cwd, args: ["rev-parse", "HEAD"] });
    const commitSha = shaResult.stdout.trim();
    const subject = commitMessage.split("\n")[0] ?? commitMessage;
    result.commit = { status: "created", commitSha, subject };
  } else if (action === "commit") {
    return result;
  }

  if (action === "commit_push" || action === "commit_push_pr") {
    if (!currentBranch) {
      result.push = { status: "skipped_not_requested" };
    } else {
      const remoteExists = await hasOriginRemote({ cwd });
      if (!remoteExists) {
        await createGhRepo({ cwd, visibility: "private" });
        result.push = { status: "pushed", branch: currentBranch, setUpstream: true };
      } else {
        const upstreamCheck = await execGit({
          cwd,
          args: ["config", "branch." + currentBranch + ".remote"],
        });
        const needsUpstream = upstreamCheck.code !== 0;
        const pushArgs = needsUpstream
          ? ["push", "-u", "origin", currentBranch]
          : ["push"];
        requireOk(await execGit({ cwd, args: pushArgs }), "push");
        result.push = {
          status: "pushed",
          branch: currentBranch,
          setUpstream: needsUpstream,
        };
      }
    }
  }

  if (action === "commit_push_pr" && currentBranch) {
    const configResult = await execGit({
      cwd,
      args: ["config", "branch." + currentBranch + ".gh-merge-base"],
    });
    let baseBranch = configResult.code === 0 && configResult.stdout.trim()
      ? configResult.stdout.trim()
      : await getDefaultBranch({ cwd });

    if ((baseBranch === "main" || baseBranch === "master") && currentBranch !== "pre-release") {
      const preReleaseCheck = await execGit({ cwd, args: ["rev-parse", "--verify", "pre-release"] });
      if (preReleaseCheck.code === 0) {
        baseBranch = "pre-release";
      }
    }

    let prTitle: string;
    let prBody: string;
    try {
      const rangeCtx = await getRangeContext(cwd, baseBranch);
      const generated = await ai.generatePrContent({
        cwd,
        baseBranch,
        headBranch: currentBranch,
        commitSummary: rangeCtx.commitSummary,
        diffSummary: rangeCtx.diffSummary,
        diffPatch: rangeCtx.diffPatch,
      });
      prTitle = generated.title;
      prBody = generated.body;
    } catch {
      prTitle = result.commit.subject ?? "Update";
      prBody = "";
    }

    try {
      const pr = await createPullRequest({ cwd, baseBranch, title: prTitle, body: prBody });
      result.pr = {
        status: "created",
        url: pr.url,
        number: pr.number,
        baseBranch: pr.baseBranch,
        headBranch: pr.headBranch,
        title: pr.title,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message.includes("already exists")) {
        result.pr = { status: "opened_existing" };
      } else {
        throw err;
      }
    }
  }

  return result;
}

function formatTimeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return String(seconds) + " seconds ago";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return String(minutes) + " minute" + (minutes === 1 ? "" : "s") + " ago";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return String(hours) + " hour" + (hours === 1 ? "" : "s") + " ago";
  const days = Math.floor(hours / 24);
  if (days < 7) return String(days) + " day" + (days === 1 ? "" : "s") + " ago";
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return String(weeks) + " week" + (weeks === 1 ? "" : "s") + " ago";
  const months = Math.floor(days / 30);
  if (months < 12) return String(months) + " month" + (months === 1 ? "" : "s") + " ago";
  const years = Math.floor(days / 365);
  return String(years) + " year" + (years === 1 ? "" : "s") + " ago";
}

// ---------------------------------------------------------------------------
// Merge pull requests — full stack merge flow matching hapcode's GitManager
// ---------------------------------------------------------------------------

export interface MergePullRequestsInput {
  cwd: string;
  scope: "current" | "stack";
  prs: Array<{
    number: number;
    headBranch: string;
    baseBranch: string;
  }>;
  versionBump?: "patch" | "minor" | "major" | null;
}

export interface MergePullRequestsResult {
  merged: number[];
  tag: string | null;
  finalBranch: string | null;
  error: string | null;
}

const PROTECTED_BRANCHES = ["main", "master", "pre-release"];

function isProtectedBranch(name: string) {
  return PROTECTED_BRANCHES.includes(name);
}

async function gitRun(cwd: string, args: string[], timeout = 30_000) {
  return runProcess("git", args, cwd, timeout);
}

async function ghRun(cwd: string, args: string[], timeout = 30_000) {
  return runProcess("gh", args, cwd, timeout);
}

function requireOk(result: ExecResult, label: string) {
  if (result.code !== 0) throw new Error(`${label} failed: ${result.stderr}`);
  return result.stdout;
}

/**
 * Ensure a local branch matches its origin counterpart. Compares refs and
 * hard-resets (or update-refs) when they diverge, so stale local-only commits
 * from prior failed pushes don't accumulate.
 */
async function syncLocalToOrigin(cwd: string, branch: string, currentBranch: string) {
  try {
    const localRes = await gitRun(cwd, ["rev-parse", branch]);
    const remoteRes = await gitRun(cwd, ["rev-parse", `origin/${branch}`]);
    if (localRes.code !== 0 || remoteRes.code !== 0) return;

    const localSha = localRes.stdout.trim();
    const remoteSha = remoteRes.stdout.trim();
    if (localSha === remoteSha) return;

    if (currentBranch === branch) {
      await gitRun(cwd, ["reset", "--hard", `origin/${branch}`]);
    } else {
      await gitRun(cwd, ["update-ref", `refs/heads/${branch}`, `origin/${branch}`]);
    }
  } catch { /* best effort — don't break the merge flow */ }
}

function shouldRetryMerge(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes("pull request is not mergeable") ||
    msg.includes("is not mergeable") ||
    msg.includes("merge conflict") ||
    msg.includes("conflict") ||
    msg.includes("head branch was modified") ||
    msg.includes("base branch was modified") ||
    msg.includes("required status check") ||
    msg.includes("review required")
  );
}

const MERGE_RETRY_DELAYS = [2_000, 4_000, 6_000, 8_000];

async function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function resolveRevision(cwd: string, candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    const result = await gitRun(cwd, ["rev-parse", candidate]);
    const sha = result.stdout.trim();
    if (result.code === 0 && sha.length > 0) return sha;
  }
  return null;
}

async function readBranchPresence(cwd: string, branchName: string) {
  await gitRun(cwd, ["fetch", "--quiet", "--prune", "origin"]).catch(() => {});
  const result = await gitRun(cwd, ["branch", "-a", "--list", branchName, `remotes/origin/${branchName}`]);
  const lines = result.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  return {
    hasLocal: lines.some((l) => l === branchName || l === `* ${branchName}`),
    hasRemote: lines.some((l) => l === `remotes/origin/${branchName}`),
  };
}

async function deleteBranchIfPresent(cwd: string, branchName: string) {
  const presence = await readBranchPresence(cwd, branchName);
  if (!presence.hasLocal && !presence.hasRemote) return;
  if (presence.hasRemote) {
    await gitRun(cwd, ["push", "origin", "--delete", branchName]).catch(() => {});
  }
  if (presence.hasLocal) {
    await gitRun(cwd, ["branch", "-D", "--", branchName]).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Version bump — update package.json, commit, tag, push
// ---------------------------------------------------------------------------

export interface VersionBumpInput {
  cwd: string;
  bump: "patch" | "minor" | "major";
}

export interface VersionBumpResult {
  tag: string;
  version: string;
  error: string | null;
}

/**
 * Compute the bumped version string from the current package.json.
 */
async function computeBumpedVersion(cwd: string, bump: "patch" | "minor" | "major") {
  const pkgPath = path.join(cwd, "package.json");
  const raw = await fs.readFile(pkgPath, "utf-8");
  const pkg = JSON.parse(raw) as { version?: string };
  const current = pkg.version ?? "0.0.0";
  const m = current.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) throw new Error(`Invalid version in package.json: ${current}`);

  let [major, minor, patch] = [+m[1], +m[2], +m[3]];
  if (bump === "major") { major++; minor = 0; patch = 0; }
  else if (bump === "minor") { minor++; patch = 0; }
  else { patch++; }

  const newVersion = `${major}.${minor}.${patch}`;
  return { raw, pkgPath, newVersion, tag: `v${newVersion}` };
}

/**
 * Update package.json, commit, and push — used on the head branch before merge
 * so the version bump is part of the PR content.
 */
async function commitVersionBump(cwd: string, bump: "patch" | "minor" | "major") {
  const { raw, pkgPath, newVersion, tag } = await computeBumpedVersion(cwd, bump);
  const updated = raw.replace(/"version"\s*:\s*"[^"]*"/, `"version": "${newVersion}"`);
  await fs.writeFile(pkgPath, updated, "utf-8");
  requireOk(await gitRun(cwd, ["add", "package.json"]), "stage package.json");
  requireOk(await gitRun(cwd, ["commit", "-m", `chore: bump version to ${tag}`]), "version commit");
  requireOk(await gitRun(cwd, ["push", "origin", "HEAD"]), "push version bump");
  return tag;
}

/**
 * Create a git tag on the current commit and push it.
 */
async function createAndPushTag(cwd: string, tag: string) {
  requireOk(await gitRun(cwd, ["tag", tag]), "create tag");
  requireOk(await gitRun(cwd, ["push", "origin", tag]), "push tag");
}

/**
 * Full standalone version bump — update package.json, commit, tag, push.
 */
export async function versionBump(input: VersionBumpInput): Promise<VersionBumpResult> {
  try {
    const tag = await commitVersionBump(input.cwd, input.bump);
    await createAndPushTag(input.cwd, tag);
    return { tag, version: tag.slice(1), error: null };
  } catch (err) {
    return { tag: "", version: "", error: err instanceof Error ? err.message : "Version bump failed." };
  }
}

// ---------------------------------------------------------------------------
// Merge pull requests — full stack merge flow
// ---------------------------------------------------------------------------

export async function mergePullRequests(input: MergePullRequestsInput): Promise<MergePullRequestsResult> {
  const { cwd, prs } = input;
  const mergeBaseBranch = prs[0].baseBranch;
  const isStack = prs.length > 1;
  const merged: Array<{ number: number; headBranch: string }> = [];
  const autoClosedBranches: string[] = [];
  let finalBranch: string | null = null;

  async function readPr(number: number): Promise<{ state: string; baseRefName: string } | null> {
    const result = await ghRun(cwd, [
      "pr", "view", String(number), "--json", "state,baseRefName",
    ]);
    if (result.code !== 0) return null;
    return JSON.parse(result.stdout) as { state: string; baseRefName: string };
  }

  async function mergePrWithRetry(prNumber: number, headBranch: string, attempt = 0): Promise<void> {
    const mergeArgs = ["pr", "merge", String(prNumber), "--squash"];
    if (!isStack && !isProtectedBranch(headBranch)) {
      mergeArgs.push("--delete-branch");
    }
    const result = await ghRun(cwd, mergeArgs, 60_000);
    if (result.code === 0) return;

    const refreshed = await readPr(prNumber);
    if (refreshed && refreshed.state !== "OPEN") return;

    const error = new Error(`merge PR #${prNumber} failed: ${result.stderr}`);
    if (attempt < 4 && shouldRetryMerge(error)) {
      await sleep(MERGE_RETRY_DELAYS[attempt] ?? 2_000);
      return mergePrWithRetry(prNumber, headBranch, attempt + 1);
    }
    throw error;
  }

  async function mergeLoop() {
    await gitRun(cwd, ["fetch", "--quiet", "--prune", "origin"]);

    const originalBranchTips = new Map<string, string>();
    for (const pr of prs) {
      const tip = await resolveRevision(cwd, [
        `refs/remotes/origin/${pr.headBranch}`,
        `origin/${pr.headBranch}`,
        pr.headBranch,
      ]);
      if (tip) originalBranchTips.set(pr.headBranch, tip);
    }

    for (const [index, pr] of prs.entries()) {
      const reference = String(pr.number);

      const currentPr = await readPr(pr.number);
      if (currentPr && currentPr.state !== "OPEN") {
        if (!isProtectedBranch(pr.headBranch)) {
          autoClosedBranches.push(pr.headBranch);
        }
        continue;
      }

      if (currentPr && currentPr.baseRefName !== mergeBaseBranch) {
        await ghRun(cwd, ["pr", "edit", reference, "--base", mergeBaseBranch]);

        const afterRetarget = await readPr(pr.number);
        if (afterRetarget && afterRetarget.state !== "OPEN") {
          if (!isProtectedBranch(pr.headBranch)) {
            autoClosedBranches.push(pr.headBranch);
          }
          continue;
        }
      }

      const previousPr = index > 0 ? prs[index - 1] : null;
      if (previousPr) {
        const previousBranchTip = originalBranchTips.get(previousPr.headBranch);
        if (!previousBranchTip) {
          throw new Error(
            `Failed to locate the original tip of ${previousPr.headBranch} before rebasing ${pr.headBranch}.`,
          );
        }

        await gitRun(cwd, ["fetch", "--quiet", "origin", mergeBaseBranch]);
        await gitRun(cwd, ["checkout", pr.headBranch]);

        const ancestorCheck = await gitRun(cwd, [
          "merge-base", "--is-ancestor", previousBranchTip, "HEAD",
        ]);
        const needsRebase = ancestorCheck.code === 0;

        if (needsRebase) {
          const rebaseResult = await gitRun(cwd, [
            "rebase", "--onto", `origin/${mergeBaseBranch}`, previousBranchTip,
          ]);
          if (rebaseResult.code !== 0) {
            await gitRun(cwd, ["rebase", "--abort"]);
            throw new Error(
              `Rebase of ${pr.headBranch} onto ${mergeBaseBranch} failed — resolve conflicts manually.`,
            );
          }
          requireOk(
            await gitRun(cwd, ["push", "--force-with-lease", "-u", "origin", `HEAD:${pr.headBranch}`]),
            `push rebased ${pr.headBranch}`,
          );
          // Give GitHub time to process the force push and recalculate mergeability
          await sleep(3_000);
        }
      }

      await mergePrWithRetry(pr.number, pr.headBranch);
      merged.push({ number: pr.number, headBranch: pr.headBranch });

      await gitRun(cwd, ["fetch", "--quiet", "--prune", "origin"]);
    }
  }

  async function finalize() {
    if (merged.length === 0) return;

    const headResult = await gitRun(cwd, ["branch", "--show-current"]);
    let currentBranch = headResult.stdout.trim();

    await gitRun(cwd, ["fetch", "--quiet", "--prune", "origin"]);

    const mergedProtectedHead = merged.find(
      (m) => isProtectedBranch(m.headBranch) && m.headBranch !== mergeBaseBranch,
    );
    const shouldCheckoutBaseAfterMerge =
      mergedProtectedHead !== undefined ||
      (currentBranch.length > 0 &&
        (
          merged.some((m) => m.headBranch === currentBranch && m.headBranch !== mergeBaseBranch) ||
          autoClosedBranches.includes(currentBranch)
        ));

    for (const { headBranch } of merged) {
      if (!isProtectedBranch(headBranch)) continue;
      if (headBranch === mergeBaseBranch) continue;

      try {
        if (currentBranch === headBranch) {
          await gitRun(cwd, ["reset", "--hard", `origin/${mergeBaseBranch}`]);
          requireOk(
            await gitRun(cwd, ["push", "--force-with-lease", "-u", "origin", `HEAD:${headBranch}`]),
            `sync ${headBranch}`,
          );
        } else {
          await gitRun(cwd, ["update-ref", `refs/heads/${headBranch}`, `origin/${mergeBaseBranch}`]);
          requireOk(
            await gitRun(cwd, ["push", "--force-with-lease", "-u", "origin", `${headBranch}:${headBranch}`]),
            `sync ${headBranch}`,
          );
        }
      } catch { /* best effort */ }
    }

    // Ensure mergeBaseBranch (e.g. main) itself is in sync with origin.
    // After a squash merge, origin has a new commit that local may lack. A
    // pull --ff-only fails silently when local has diverged (old local-only
    // commits from prior failed pushes), so we compare refs and hard-reset
    // when they differ.
    await syncLocalToOrigin(cwd, mergeBaseBranch, currentBranch);

    if (shouldCheckoutBaseAfterMerge) {
      // If we merged a protected branch (e.g. pre-release → main), go back to
      // that branch instead of staying on the merge base.
      const mergedProtected = merged.find(
        (m) => isProtectedBranch(m.headBranch) && m.headBranch !== mergeBaseBranch,
      );
      const checkoutTarget = mergedProtected ? mergedProtected.headBranch : mergeBaseBranch;
      await gitRun(cwd, ["checkout", checkoutTarget]).catch(() => {});
      await syncLocalToOrigin(cwd, checkoutTarget, checkoutTarget);
      currentBranch = checkoutTarget;
      finalBranch = checkoutTarget;
    }

    for (const { headBranch } of merged) {
      if (isProtectedBranch(headBranch)) continue;
      await deleteBranchIfPresent(cwd, headBranch);
    }

    for (const branch of autoClosedBranches) {
      await deleteBranchIfPresent(cwd, branch);
    }

    if (!finalBranch) {
      await syncLocalToOrigin(cwd, currentBranch, currentBranch);
      finalBranch = currentBranch;
    }
  }

  let tag: string | null = null;

  try {
    // Version bump: commit to the head branch BEFORE merge so it's part of
    // the PR content. After merge, tag the resulting commit on main.
    if (input.versionBump && prs.length > 0) {
      try {
        const headBranch = prs[prs.length - 1].headBranch;
        await gitRun(cwd, ["checkout", headBranch]);
        await gitRun(cwd, ["pull", "--ff-only"]).catch(() => {});
        tag = await commitVersionBump(cwd, input.versionBump);
      } catch { /* version bump is best-effort */ }
    }

    await mergeLoop();

    // Tag the merge commit on the base branch
    if (tag) {
      try {
        await gitRun(cwd, ["checkout", mergeBaseBranch]);
        await gitRun(cwd, ["pull", "--ff-only"]).catch(() => {});
        await createAndPushTag(cwd, tag);
      } catch { /* tagging is best-effort */ }
    }

    await finalize();
    return { merged: merged.map((m) => m.number), tag, finalBranch, error: null };
  } catch (err) {
    try { await finalize(); } catch { /* ignore cleanup errors */ }
    return {
      merged: merged.map((m) => m.number),
      tag,
      finalBranch,
      error: err instanceof Error ? err.message : "Merge failed.",
    };
  }
}
