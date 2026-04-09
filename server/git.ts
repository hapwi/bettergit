import fs from "node:fs/promises";
import path from "node:path";
import { runProcess, type ExecResult } from "./env";

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
