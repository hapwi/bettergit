/**
 * Commit operations — log, commit, stage, diff.
 */
import { execGit, requireSuccess } from "./exec";

export interface CommitEntry {
  sha: string;
  shortSha: string;
  subject: string;
  body: string;
  author: string;
  date: string;
  relativeDate: string;
}

export async function getLog(
  cwd: string,
  count = 50,
  branch?: string,
): Promise<CommitEntry[]> {
  const args = [
    "log",
    `--max-count=${count}`,
    "--format=%H|%h|%s|%b|%an|%ai|%ar",
    "--no-merges",
  ];
  if (branch) args.push(branch);

  const stdout = requireSuccess(await execGit(cwd, args), "git log");

  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, shortSha, subject, body, author, date, relativeDate] =
        line.split("|");
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

export async function stageFiles(cwd: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  requireSuccess(await execGit(cwd, ["add", ...paths]), "stage files");
}

export async function stageAll(cwd: string): Promise<void> {
  requireSuccess(await execGit(cwd, ["add", "-A"]), "stage all");
}

export async function unstageFiles(cwd: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  requireSuccess(
    await execGit(cwd, ["reset", "HEAD", "--", ...paths]),
    "unstage files",
  );
}

export async function commit(
  cwd: string,
  message: string,
): Promise<{ sha: string }> {
  requireSuccess(await execGit(cwd, ["commit", "-m", message]), "commit");
  const shaResult = await execGit(cwd, ["rev-parse", "HEAD"]);
  return { sha: shaResult.stdout.trim() };
}

export async function getDiff(
  cwd: string,
  staged = false,
): Promise<string> {
  const args = staged ? ["diff", "--cached"] : ["diff"];
  const result = await execGit(cwd, args);
  return result.stdout;
}

export async function discardAllChanges(cwd: string): Promise<void> {
  // Reset any staged changes
  await execGit(cwd, ["reset", "HEAD"]);
  // Discard all tracked file modifications
  requireSuccess(await execGit(cwd, ["checkout", "--", "."]), "discard tracked changes");
  // Remove untracked files and directories
  requireSuccess(await execGit(cwd, ["clean", "-fd"]), "discard untracked files");
}

/**
 * Get unified diff patch for all local changes (tracked + untracked).
 * Returns a single string suitable for parsePatchFiles from @pierre/diffs.
 */
export async function getFullDiffPatch(cwd: string): Promise<string> {
  // Get diff for tracked changes against HEAD
  const trackedResult = await execGit(cwd, ["diff", "HEAD"]);
  const trackedPatch = trackedResult.stdout;

  // Find untracked files
  const untrackedResult = await execGit(cwd, [
    "ls-files", "--others", "--exclude-standard",
  ]);
  const untrackedFiles = untrackedResult.stdout.trim().split("\n").filter(Boolean);

  // Generate diffs for untracked files (as new file patches)
  const untrackedPatches: string[] = [];
  for (const file of untrackedFiles) {
    const result = await execGit(cwd, ["diff", "--no-index", "/dev/null", file]);
    // --no-index returns exit code 1 when there are differences, which is expected
    if (result.stdout) {
      untrackedPatches.push(result.stdout);
    }
  }

  return [trackedPatch, ...untrackedPatches].filter(Boolean).join("\n");
}

export async function getDiffStat(
  cwd: string,
  staged = false,
): Promise<string> {
  const args = staged ? ["diff", "--cached", "--stat"] : ["diff", "--stat"];
  const result = await execGit(cwd, args);
  return result.stdout;
}
