import { execGit } from "./git-exec";

export interface WorkingTreeFile {
  path: string;
  insertions: number;
  deletions: number;
  rawStatus: string;
  indexStatus: string;
  workingTreeStatus: string;
  displayStatus: "M" | "A" | "D" | "R" | "C" | "U";
  originalPath?: string;
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
  const statusByPath = new Map<
    string,
    Pick<WorkingTreeFile, "rawStatus" | "indexStatus" | "workingTreeStatus" | "displayStatus" | "originalPath">
  >();

  const deriveDisplayStatus = (indexStatus: string, workingTreeStatus: string): WorkingTreeFile["displayStatus"] => {
    if (indexStatus === "?" && workingTreeStatus === "?") return "U";
    if (indexStatus === "U" || workingTreeStatus === "U") return "C";
    if (indexStatus === "D" || workingTreeStatus === "D") return "D";
    if (indexStatus === "R" || workingTreeStatus === "R") return "R";
    if (indexStatus === "A" || workingTreeStatus === "A") return "A";
    return "M";
  };

  const recordStatus = (
    filePath: string,
    rawStatus: string,
    originalPath?: string,
  ) => {
    if (!filePath) return;
    const indexStatus = rawStatus[0] ?? ".";
    const workingTreeStatus = rawStatus[1] ?? ".";
    statusByPath.set(filePath, {
      rawStatus,
      indexStatus,
      workingTreeStatus,
      displayStatus: deriveDisplayStatus(indexStatus, workingTreeStatus),
      originalPath,
    });
    changedPaths.push(filePath);
  };

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

        if (filePath && !isNestedRepoDirtyOnly) recordStatus(filePath, xy);
      }
    } else if (line.startsWith("2 ")) {
      const tabIdx = line.indexOf("\t");
      if (tabIdx >= 0) {
        const meta = line.slice(2, tabIdx).split(" ");
        const xy = meta[0] ?? "";
        const parts = line.slice(tabIdx + 1).split("\t");
        const filePath = parts[0];
        const originalPath = parts[1];
        if (filePath) recordStatus(filePath, xy, originalPath);
      }
    } else if (line.startsWith("? ")) {
      recordStatus(line.slice(2), "??");
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
          const existingStatus = statusByPath.get(filePath);
          return {
            path: filePath,
            insertions: Number.isFinite(insertions) ? insertions : 0,
            deletions: Number.isFinite(deletions) ? deletions : 0,
            rawStatus: existingStatus?.rawStatus ?? "MM",
            indexStatus: existingStatus?.indexStatus ?? "M",
            workingTreeStatus: existingStatus?.workingTreeStatus ?? "M",
            displayStatus: existingStatus?.displayStatus ?? "M",
            originalPath: existingStatus?.originalPath,
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
        const existingStatus = statusByPath.get(filePath);
        files.push({
          path: filePath,
          insertions: 0,
          deletions: 0,
          rawStatus: existingStatus?.rawStatus ?? "MM",
          indexStatus: existingStatus?.indexStatus ?? "M",
          workingTreeStatus: existingStatus?.workingTreeStatus ?? "M",
          displayStatus: existingStatus?.displayStatus ?? "M",
          originalPath: existingStatus?.originalPath,
        });
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
