import { execGit, requireOk } from "./git-exec";
import { getCurrentBranch, getDefaultBranch } from "./git-branches";
import { hasOriginRemote } from "./git-remote";
import { createGhRepo } from "./git-github";
import { createPullRequest } from "./git-pr";
import { getRangeContext } from "./git-release";
import * as ai from "./ai";

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
        requireOk(await execGit({ cwd, args: pushArgs, timeoutMs: 10 * 60_000 }), "push");
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
