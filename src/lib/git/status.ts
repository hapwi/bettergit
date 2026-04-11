/**
 * Git status — rich repo status matching hapcode's model.
 */
import { execGit } from "./exec";
import type { PullRequestSummary } from "./github";

export interface WorkingTreeFile {
  path: string;
  insertions: number;
  deletions: number;
}

export interface GitStatus {
  branch: string | null;
  isRepo: boolean;
  hasWorkingTreeChanges: boolean;
  workingTree: {
    files: WorkingTreeFile[];
    insertions: number;
    deletions: number;
  };
  hasUpstream: boolean;
  aheadCount: number;
  behindCount: number;
  pr: PullRequestSummary | null;
}

export async function getStatus(cwd: string): Promise<GitStatus> {
  const result = await execGit(cwd, [
    "status",
    "--porcelain=v2",
    "--branch",
    "--untracked-files=normal",
  ]);

  if (result.code !== 0) {
    return {
      branch: null,
      isRepo: false,
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
  let aheadCount = 0;
  let behindCount = 0;
  let hasUpstream = false;
  const changedPaths: string[] = [];

  for (const line of lines) {
    if (line.startsWith("# branch.head ")) {
      branch = line.slice("# branch.head ".length);
      if (branch === "(detached)") branch = null;
    } else if (line.startsWith("# branch.upstream ")) {
      hasUpstream = true;
    } else if (line.startsWith("# branch.ab ")) {
      const match = line.match(/^# branch\.ab \+(\d+) -(\d+)$/);
      if (match) {
        aheadCount = parseInt(match[1], 10);
        behindCount = parseInt(match[2], 10);
      }
    } else if (line.startsWith("1 ")) {
      // Ordinary changed entry: "1 XY sub m1 m2 m3 h1 h2 path"
      const parts = line.split(" ");
      // Path is everything after the 8th space-separated field
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

        // Nested repos/gitlinks can report a dirty working tree in porcelain v2
        // without any parent-repo diff to stage or commit. Ignore those entries
        // so the parent repo only reports committable changes.
        if (filePath && !isNestedRepoDirtyOnly) changedPaths.push(filePath);
      }
    } else if (line.startsWith("2 ")) {
      // Rename/copy entry: "2 XY sub m1 m2 m3 h1 h2 Xscore\tpath\torigPath"
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

  // If no upstream, compute ahead count against default branch (main/master)
  if (!hasUpstream && branch) {
    const defaultBranches = ["main", "master"];
    for (const base of defaultBranches) {
      if (base === branch) continue;
      const countResult = await execGit(cwd, ["rev-list", "--count", `${base}..${branch}`]);
      if (countResult.code === 0) {
        const count = parseInt(countResult.stdout.trim(), 10);
        if (count > 0) aheadCount = count;
        break;
      }
    }
  }

  // Get numstat for insertions/deletions
  let files: WorkingTreeFile[] = [];
  if (changedPaths.length > 0) {
    const numstatResult = await execGit(cwd, ["diff", "--numstat", "HEAD"]);
    const untrackedResult = await execGit(cwd, [
      "diff",
      "--numstat",
      "--no-index",
      "/dev/null",
      ...changedPaths.filter((p) => !numstatResult.stdout.includes(p)),
    ]);

    const parseNumstat = (stdout: string): WorkingTreeFile[] => {
      return stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [addedRaw, deletedRaw, ...pathParts] = line.split("\t");
          const path = pathParts.join("\t").trim();
          if (!path) return null;
          const insertions = parseInt(addedRaw ?? "0", 10);
          const deletions = parseInt(deletedRaw ?? "0", 10);
          return {
            path,
            insertions: Number.isFinite(insertions) ? insertions : 0,
            deletions: Number.isFinite(deletions) ? deletions : 0,
          };
        })
        .filter((f): f is WorkingTreeFile => f !== null);
    };

    const tracked = parseNumstat(numstatResult.stdout);
    const untracked = parseNumstat(untrackedResult.stdout);
    const trackedPaths = new Set(tracked.map((f) => f.path));
    files = [...tracked, ...untracked.filter((f) => !trackedPaths.has(f.path))];

    // Ensure all changed paths are represented
    const filePaths = new Set(files.map((f) => f.path));
    for (const p of changedPaths) {
      if (!filePaths.has(p)) {
        files.push({ path: p, insertions: 0, deletions: 0 });
      }
    }
  }

  const totalInsertions = files.reduce((sum, f) => sum + f.insertions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  return {
    branch,
    isRepo: true,
    hasWorkingTreeChanges: changedPaths.length > 0,
    workingTree: {
      files,
      insertions: totalInsertions,
      deletions: totalDeletions,
    },
    hasUpstream,
    aheadCount,
    behindCount,
    pr: null,
  };
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  const result = await execGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
  return result.code === 0 && result.stdout.trim() === "true";
}

export async function getRepoRoot(cwd: string): Promise<string | null> {
  const result = await execGit(cwd, ["rev-parse", "--show-toplevel"]);
  return result.code === 0 ? result.stdout.trim() : null;
}
