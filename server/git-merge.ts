import { runProcess, type ExecResult } from "./env";
import { listPrs } from "./git-pr";
import { readOriginRepoSlug } from "./git-exec";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROTECTED_BRANCHES = ["main", "master", "pre-release"];
const LONG_RUNNING_GIT_TIMEOUT_MS = 10 * 60_000;
const MERGE_RETRY_DELAYS = [2_000, 4_000, 6_000, 8_000];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isProtectedBranch(name: string) {
  return PROTECTED_BRANCHES.includes(name);
}

async function gitRun(cwd: string, args: string[], timeout = LONG_RUNNING_GIT_TIMEOUT_MS) {
  return runProcess("git", args, cwd, timeout);
}

async function ghRun(cwd: string, args: string[], timeout = LONG_RUNNING_GIT_TIMEOUT_MS) {
  return runProcess("gh", args, cwd, timeout);
}

function requireOk(result: ExecResult, label: string) {
  if (result.code !== 0) throw new Error(`${label} failed: ${result.stderr}`);
  return result.stdout;
}

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

async function deleteRemoteBranch(cwd: string, branchName: string): Promise<boolean> {
  // Try GitHub API first — more reliable than git push for branch deletion
  const repo = await readOriginRepoSlug(cwd);
  if (repo) {
    const apiResult = await ghRun(cwd, [
      "api", "-X", "DELETE", `repos/${repo}/git/refs/heads/${branchName}`,
    ]);
    if (apiResult.code === 0) return true;
    // 422 = ref doesn't exist (already deleted) — treat as success
    if (apiResult.stderr.includes("422") || apiResult.stderr.includes("Reference does not exist")) return true;
    console.warn(`[merge] GitHub API delete of ${branchName} failed: ${apiResult.stderr.trim()}`);
  }

  // Fallback: git push --delete
  const pushResult = await gitRun(cwd, ["push", "origin", "--delete", branchName]);
  if (pushResult.code === 0) return true;
  if (pushResult.stderr.includes("remote ref does not exist")) return true;

  console.warn(`[merge] git push --delete ${branchName} failed: ${pushResult.stderr.trim()}`);
  return false;
}

async function deleteBranchIfPresent(cwd: string, branchName: string) {
  // Delete remote branch
  await deleteRemoteBranch(cwd, branchName);

  // Delete local branch
  const localCheck = await gitRun(cwd, ["rev-parse", "--verify", `refs/heads/${branchName}`]);
  if (localCheck.code === 0) {
    const result = await gitRun(cwd, ["branch", "-D", "--", branchName]);
    if (result.code !== 0) {
      console.warn(`[merge] local delete of ${branchName} failed: ${result.stderr.trim()}`);
    }
  }

  // Prune stale remote tracking refs
  await gitRun(cwd, ["fetch", "--quiet", "--prune", "origin"]).catch(() => {});
}

async function deleteMergedBranchesForBase(cwd: string, baseBranch: string) {
  const mergedPrs = await listPrs(cwd, "merged", 100, baseBranch);

  for (const pr of mergedPrs) {
    if (!pr.headBranch || isProtectedBranch(pr.headBranch)) continue;

    // Check if branch still exists anywhere
    const remoteSha = await resolveRevision(cwd, [
      `refs/remotes/origin/${pr.headBranch}`,
      `origin/${pr.headBranch}`,
    ]);
    const localSha = await resolveRevision(cwd, [pr.headBranch]);
    if (!remoteSha && !localSha) continue;

    // If we have the merged PR's head SHA, only skip deletion when the
    // branch has moved FORWARD (new commits after merge). A SHA mismatch
    // from rebase/force-push should still be cleaned up — the PR is merged.
    const mergedHeadSha = pr.headSha?.trim();
    if (mergedHeadSha && remoteSha && remoteSha !== mergedHeadSha) {
      // Check if the current branch tip is an ancestor of the merge base.
      // If it is, the branch hasn't moved forward — safe to delete.
      const mergeBaseResult = await gitRun(cwd, [
        "merge-base", "--is-ancestor", remoteSha, `origin/${baseBranch}`,
      ]);
      if (mergeBaseResult.code !== 0) {
        // Branch has commits not in baseBranch — someone pushed after merge, skip
        continue;
      }
    }

    await deleteBranchIfPresent(cwd, pr.headBranch);
  }
}

import type { MergePullRequestsInput, MergePullRequestsResult } from "../shared/workflows";

// ---------------------------------------------------------------------------
// Main merge flow
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
    const result = await ghRun(cwd, mergeArgs, LONG_RUNNING_GIT_TIMEOUT_MS);
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

    await syncLocalToOrigin(cwd, mergeBaseBranch, currentBranch);

    if (shouldCheckoutBaseAfterMerge) {
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

    const cleanupBases = new Set<string>();
    if (isProtectedBranch(mergeBaseBranch)) cleanupBases.add(mergeBaseBranch);
    for (const { headBranch } of merged) {
      if (isProtectedBranch(headBranch)) cleanupBases.add(headBranch);
    }
    for (const branch of cleanupBases) {
      await deleteMergedBranchesForBase(cwd, branch);
    }

    if (!finalBranch) {
      await syncLocalToOrigin(cwd, currentBranch, currentBranch);
      finalBranch = currentBranch;
    }
  }

  let tag: string | null = null;

  try {
    if (input.versionBump && prs.length > 0) {
      try {
        const headBranch = prs[prs.length - 1].headBranch;
        await gitRun(cwd, ["checkout", headBranch]);
        await gitRun(cwd, ["pull", "--ff-only"]).catch(() => {});
        tag = await commitVersionBump(cwd, input.versionBump);
      } catch { /* version bump is best-effort */ }
    }

    await mergeLoop();

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

// ---------------------------------------------------------------------------
// Version bump helpers (used by merge flow)
// ---------------------------------------------------------------------------

import fs from "node:fs/promises";
import path from "node:path";

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

async function commitVersionBump(cwd: string, bump: "patch" | "minor" | "major") {
  const { raw, pkgPath, newVersion, tag } = await computeBumpedVersion(cwd, bump);
  const updated = raw.replace(/"version"\s*:\s*"[^"]*"/, `"version": "${newVersion}"`);
  await fs.writeFile(pkgPath, updated, "utf-8");
  requireOk(await gitRun(cwd, ["add", "package.json"]), "stage package.json");
  requireOk(await gitRun(cwd, ["commit", "-m", `chore: bump version to ${tag}`]), "version commit");
  requireOk(await gitRun(cwd, ["push", "origin", "HEAD"]), "push version bump");
  return tag;
}

async function createAndPushTag(cwd: string, tag: string) {
  requireOk(await gitRun(cwd, ["tag", tag]), "create tag");
  requireOk(await gitRun(cwd, ["push", "origin", tag]), "push tag");
}
