/**
 * Stacked git actions — the commit → push → PR pipeline.
 */
import { execGit, requireSuccess } from "./exec";
import { generateCommitMessage, generatePrContent } from "./ai";
import { createPullRequest, createGhRepo } from "./github";
import { hasOriginRemote as checkOriginRemote } from "./remote";
import { sanitizeFeatureBranchName, resolveAutoFeatureBranchName } from "./branch-utils";

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

async function getCurrentBranch(cwd: string): Promise<string | null> {
  const result = await execGit(cwd, ["branch", "--show-current"]);
  return result.code === 0 ? result.stdout.trim() || null : null;
}

async function getDefaultBranch(cwd: string): Promise<string> {
  const result = await execGit(cwd, ["symbolic-ref", "refs/remotes/origin/HEAD", "--short"]);
  if (result.code === 0) return result.stdout.trim().replace(/^origin\//, "");
  const branchResult = await execGit(cwd, ["branch", "--list", "main", "master"]);
  const branches = branchResult.stdout.trim().split("\n").map((b) => b.trim().replace(/^\* /, "")).filter(Boolean);
  return branches.includes("main") ? "main" : branches[0] ?? "main";
}

async function listLocalBranchNames(cwd: string): Promise<string[]> {
  const result = await execGit(cwd, ["branch", "--format=%(refname:short)"]);
  return result.stdout.trim().split("\n").filter(Boolean);
}

async function getStagedSummary(cwd: string): Promise<string> {
  const result = await execGit(cwd, ["diff", "--cached", "--stat"]);
  return result.stdout;
}

async function getStagedPatch(cwd: string): Promise<string> {
  const result = await execGit(cwd, ["diff", "--cached"]);
  return result.stdout.slice(0, 50_000); // Limit for AI context
}

async function getRangeContext(
  cwd: string,
  baseBranch: string,
): Promise<{ commitSummary: string; diffSummary: string; diffPatch: string }> {
  const [commitResult, diffStatResult, diffPatchResult] = await Promise.all([
    execGit(cwd, ["log", `${baseBranch}..HEAD`, "--oneline", "--no-merges"]),
    execGit(cwd, ["diff", `${baseBranch}...HEAD`, "--stat"]),
    execGit(cwd, ["diff", `${baseBranch}...HEAD`]),
  ]);
  return {
    commitSummary: commitResult.stdout.slice(0, 20_000),
    diffSummary: diffStatResult.stdout.slice(0, 20_000),
    diffPatch: diffPatchResult.stdout.slice(0, 60_000),
  };
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

  let currentBranch = await getCurrentBranch(cwd);
  const parentBranch = currentBranch; // Track the branch we're branching from

  // Feature branch creation
  if (input.featureBranch) {
    // Stage files first so AI can see the changes
    if (filePaths && filePaths.length > 0) {
      requireSuccess(await execGit(cwd, ["add", "--", ...filePaths]), "stage files");
    } else {
      requireSuccess(await execGit(cwd, ["add", "-A"]), "stage all");
    }

    const stagedSummary = await getStagedSummary(cwd);
    const stagedPatch = await getStagedPatch(cwd);

    // Generate branch name + commit message together
    let branchName: string;
    try {
      const generated = await generateCommitMessage({
        cwd,
        branch: currentBranch,
        stagedSummary,
        stagedPatch,
        includeBranch: true,
      });
      commitMessage = commitMessage || `${generated.subject}${generated.body ? `\n\n${generated.body}` : ""}`;
      branchName = generated.branch
        ? sanitizeFeatureBranchName(generated.branch)
        : "feature/update";
    } catch {
      branchName = "feature/update";
    }

    // Ensure unique branch name
    const existingBranches = await listLocalBranchNames(cwd);
    branchName = resolveAutoFeatureBranchName(existingBranches, branchName);

    // Create and checkout the branch
    requireSuccess(await execGit(cwd, ["checkout", "-b", branchName]), `create branch ${branchName}`);
    // Store the parent branch so PRs target it instead of main
    if (parentBranch) {
      await execGit(cwd, ["config", `branch.${branchName}.gh-merge-base`, parentBranch]);
    }
    currentBranch = branchName;
    result.branch = { status: "created", name: branchName };
  }

  // Stage files (if not already done for feature branch)
  if (!input.featureBranch) {
    if (filePaths && filePaths.length > 0) {
      requireSuccess(await execGit(cwd, ["add", "--", ...filePaths]), "stage files");
    } else {
      requireSuccess(await execGit(cwd, ["add", "-A"]), "stage all");
    }
  }

  // Check if there are staged changes
  const stagedCheck = await execGit(cwd, ["diff", "--cached", "--quiet"]);
  const hasStagedChanges = stagedCheck.code !== 0;

  // Commit
  if (hasStagedChanges) {
    if (!commitMessage) {
      // AI-generate commit message
      const stagedSummary = await getStagedSummary(cwd);
      const stagedPatch = await getStagedPatch(cwd);
      try {
        const generated = await generateCommitMessage({
          cwd,
          branch: currentBranch,
          stagedSummary,
          stagedPatch,
        });
        commitMessage = `${generated.subject}${generated.body ? `\n\n${generated.body}` : ""}`;
      } catch {
        commitMessage = "Update project files";
      }
    }

    requireSuccess(await execGit(cwd, ["commit", "-m", commitMessage]), "commit");
    const shaResult = await execGit(cwd, ["rev-parse", "HEAD"]);
    const commitSha = shaResult.stdout.trim();
    const subject = commitMessage.split("\n")[0] ?? commitMessage;
    result.commit = { status: "created", commitSha, subject };
  } else if (action === "commit") {
    // Nothing to commit and only commit was requested
    return result;
  }

  // Push
  if (action === "commit_push" || action === "commit_push_pr") {
    if (!currentBranch) {
      result.push = { status: "skipped_not_requested" };
    } else {
      // Create GitHub repo if no origin remote exists
      const hasRemote = await checkOriginRemote(cwd);
      if (!hasRemote) {
        // --push flag creates repo, adds origin, and pushes current branch
        await createGhRepo(cwd, "private");
        result.push = { status: "pushed", branch: currentBranch, setUpstream: true };
      } else {
        // Check if upstream exists
        const upstreamCheck = await execGit(cwd, [
          "config",
          `branch.${currentBranch}.remote`,
        ]);
        const needsUpstream = upstreamCheck.code !== 0;

        const pushArgs = needsUpstream
          ? ["push", "-u", "origin", currentBranch]
          : ["push"];
        requireSuccess(await execGit(cwd, pushArgs), "push");
        result.push = {
          status: "pushed",
          branch: currentBranch,
          setUpstream: needsUpstream,
        };
      }
    }
  }

  // Create PR
  if (action === "commit_push_pr" && currentBranch) {
    // Use the stored parent branch (for stacked PRs) or fall back to default
    const configResult = await execGit(cwd, ["config", `branch.${currentBranch}.gh-merge-base`]);
    let baseBranch = configResult.code === 0 && configResult.stdout.trim()
      ? configResult.stdout.trim()
      : await getDefaultBranch(cwd);

    // If pre-release exists, feature branches should target it instead of main/master
    if ((baseBranch === "main" || baseBranch === "master") && currentBranch !== "pre-release") {
      const preReleaseCheck = await execGit(cwd, ["rev-parse", "--verify", "pre-release"]);
      if (preReleaseCheck.code === 0) {
        baseBranch = "pre-release";
      }
    }

    // Generate PR content
    let prTitle: string;
    let prBody: string;
    try {
      const rangeCtx = await getRangeContext(cwd, baseBranch);
      const generated = await generatePrContent({
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
      // Fallback to commit subject
      prTitle = result.commit.subject ?? "Update";
      prBody = "";
    }

    try {
      const pr = await createPullRequest(cwd, baseBranch, prTitle, prBody);
      result.pr = {
        status: "created",
        url: pr.url,
        number: pr.number,
        baseBranch: pr.baseBranch,
        headBranch: pr.headBranch,
        title: pr.title,
      };
    } catch (err) {
      // PR may already exist
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
