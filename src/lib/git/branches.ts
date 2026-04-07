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
  const stdout = requireSuccess(
    await execGit(cwd, [
      "branch",
      "-a",
      "--format=%(HEAD)|%(refname:short)|%(upstream:short)",
    ]),
    "list branches",
  );

  const defaultBranch = await getDefaultBranch(cwd);
  const branches: Branch[] = [];

  for (const line of stdout.split("\n").filter(Boolean)) {
    const [head, name, upstream] = line.split("|");
    if (!name) continue;

    const isRemote = name.startsWith("remotes/") || name.startsWith("origin/");
    branches.push({
      name: isRemote ? name.replace(/^remotes\//, "") : name,
      current: head === "*",
      isRemote,
      isDefault: name === defaultBranch,
      upstream: upstream || null,
    });
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
  requireSuccess(
    await execGit(cwd, ["branch", force ? "-D" : "-d", branch]),
    `delete branch ${branch}`,
  );
}
