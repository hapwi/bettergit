import { execGit, requireOk } from "./git-exec";
import type { CommitEntry } from "../shared/git";

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
