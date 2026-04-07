/**
 * Branch operations — list, create, delete, checkout.
 */
import { execGit, requireSuccess } from "./exec";

export interface Branch {
  name: string;
  current: boolean;
  isRemote: boolean;
  isDefault: boolean;
  upstream: string | null;
}

export async function listBranches(cwd: string): Promise<Branch[]> {
  // List local branches + origin remote branches separately (avoids upstream refs from forks)
  const [localResult, remoteResult] = await Promise.all([
    execGit(cwd, ["branch", "--format=%(HEAD)|%(refname:short)|%(upstream:short)"]),
    execGit(cwd, ["branch", "-r", "--format=%(refname:short)", "--list", "origin/*"]),
  ]);

  requireSuccess(localResult, "list branches");
  const defaultBranch = await getDefaultBranch(cwd);
  const branches: Branch[] = [];

  // Local branches
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

  // Origin remote branches (skip HEAD and branches that already exist locally)
  const localNames = new Set(branches.map((b) => b.name));
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

export async function getDefaultBranch(cwd: string): Promise<string> {
  // Try symbolic ref first
  const result = await execGit(cwd, [
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
    "--short",
  ]);
  if (result.code === 0) {
    return result.stdout.trim().replace(/^origin\//, "");
  }

  // Fall back to checking for main/master
  const branchResult = await execGit(cwd, ["branch", "--list", "main", "master"]);
  const branches = branchResult.stdout
    .trim()
    .split("\n")
    .map((b) => b.trim().replace(/^\* /, ""))
    .filter(Boolean);

  return branches.includes("main") ? "main" : branches[0] ?? "main";
}

export async function getCurrentBranch(cwd: string): Promise<string | null> {
  const result = await execGit(cwd, ["branch", "--show-current"]);
  if (result.code !== 0) return null;
  const branch = result.stdout.trim();
  return branch || null;
}

export async function checkoutBranch(cwd: string, branch: string): Promise<void> {
  requireSuccess(await execGit(cwd, ["checkout", branch]), `checkout ${branch}`);
}

export async function createBranch(
  cwd: string,
  branch: string,
  startPoint?: string,
): Promise<void> {
  const args = ["checkout", "-b", branch];
  if (startPoint) args.push(startPoint);
  requireSuccess(await execGit(cwd, args), `create branch ${branch}`);
}

export async function deleteBranch(
  cwd: string,
  branch: string,
  force = false,
): Promise<void> {
  // Handle remote tracking branches (origin/*)
  if (branch.startsWith("origin/")) {
    const remoteBranch = branch.replace(/^origin\//, "");
    await execGit(cwd, ["push", "origin", "--delete", remoteBranch]);
    await execGit(cwd, ["fetch", "--prune", "origin"]);
    return;
  }

  // Delete local branch
  requireSuccess(
    await execGit(cwd, ["branch", force ? "-D" : "-d", "--", branch]),
    `delete branch ${branch}`,
  );

  // Also delete the remote branch if it exists
  const remoteCheck = await execGit(cwd, ["ls-remote", "--heads", "origin", branch]);
  if (remoteCheck.code === 0 && remoteCheck.stdout.trim()) {
    await execGit(cwd, ["push", "origin", "--delete", branch]);
  }

  // Prune stale remote tracking refs
  await execGit(cwd, ["fetch", "--prune", "origin"]);
}
