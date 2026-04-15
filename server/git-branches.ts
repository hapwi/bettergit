import { execGit, requireOk } from "./git-exec";
import type { Branch } from "../shared/git";

export async function listBranches(input: { cwd: string }): Promise<Branch[]> {
  const { cwd } = input;
  const [localResult, remoteResult] = await Promise.all([
    execGit({ cwd, args: ["branch", "--format=%(HEAD)|%(refname:short)|%(upstream:short)"] }),
    execGit({ cwd, args: ["branch", "-r", "--format=%(refname:short)", "--list", "origin/*"] }),
  ]);

  requireOk(localResult, "list branches");
  const defaultBranch = await getDefaultBranch({ cwd });
  const branches: Branch[] = [];

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

  const localNames = new Set(branches.map((branch) => branch.name));
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

export async function getDefaultBranch(input: { cwd: string }): Promise<string> {
  const { cwd } = input;
  const result = await execGit({
    cwd,
    args: ["symbolic-ref", "refs/remotes/origin/HEAD", "--short"],
  });
  if (result.code === 0) {
    return result.stdout.trim().replace(/^origin\//, "");
  }

  const branchResult = await execGit({ cwd, args: ["branch", "--list", "main", "master"] });
  const branches = branchResult.stdout
    .trim()
    .split("\n")
    .map((branch) => branch.trim().replace(/^\* /, ""))
    .filter(Boolean);

  return branches.includes("main") ? "main" : branches[0] ?? "main";
}

export async function getCurrentBranch(input: { cwd: string }): Promise<string | null> {
  const result = await execGit({ cwd: input.cwd, args: ["branch", "--show-current"] });
  if (result.code !== 0) return null;
  const branch = result.stdout.trim();
  return branch || null;
}

export async function checkoutBranch(input: { cwd: string; branch: string }): Promise<{ ok: true }> {
  requireOk(await execGit({ cwd: input.cwd, args: ["checkout", input.branch] }), `checkout ${input.branch}`);
  return { ok: true };
}

export async function createBranch(input: {
  cwd: string;
  branch: string;
  startPoint?: string;
}): Promise<{ ok: true }> {
  const args = ["checkout", "-b", input.branch];
  if (input.startPoint) args.push(input.startPoint);
  requireOk(await execGit({ cwd: input.cwd, args }), `create branch ${input.branch}`);
  return { ok: true };
}

export async function deleteBranch(input: {
  cwd: string;
  branch: string;
  force?: boolean;
}): Promise<{ ok: true }> {
  const { cwd, branch, force = false } = input;

  if (branch.startsWith("origin/")) {
    const remoteBranch = branch.replace(/^origin\//, "");
    await execGit({ cwd, args: ["push", "origin", "--delete", remoteBranch] });
    await execGit({ cwd, args: ["fetch", "--prune", "origin"] });
    return { ok: true };
  }

  requireOk(
    await execGit({ cwd, args: ["branch", force ? "-D" : "-d", "--", branch] }),
    `delete branch ${branch}`,
  );

  const remoteCheck = await execGit({ cwd, args: ["ls-remote", "--heads", "origin", branch] });
  if (remoteCheck.code === 0 && remoteCheck.stdout.trim()) {
    await execGit({ cwd, args: ["push", "origin", "--delete", branch] });
  }

  await execGit({ cwd, args: ["fetch", "--prune", "origin"] });
  return { ok: true };
}
