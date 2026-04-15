import { execGit, requireOk } from "./git-exec";
import { getStatus } from "./git-status";
import { hasOriginRemote } from "./git-remote";

async function ensureMainBranchInternal(cwd: string): Promise<void> {
  const status = await getStatus({ cwd });
  const mainExists = (await execGit({
    cwd,
    args: ["show-ref", "--verify", "--quiet", "refs/heads/main"],
  })).code === 0;

  if (mainExists) {
    requireOk(await execGit({ cwd, args: ["switch", "main"] }), "switch main");
    return;
  }

  if (status.branch === "master") {
    requireOk(await execGit({ cwd, args: ["branch", "-m", "master", "main"] }), "rename master to main");
    return;
  }

  if (status.isDetached) {
    if (status.hasCommits) {
      requireOk(await execGit({ cwd, args: ["switch", "-c", "main"] }), "create main branch");
    } else {
      requireOk(await execGit({ cwd, args: ["checkout", "--orphan", "main"] }), "create orphan main");
    }
    return;
  }

  if (!status.branch) {
    requireOk(await execGit({ cwd, args: ["checkout", "--orphan", "main"] }), "create orphan main");
    return;
  }

  if (!status.hasCommits) {
    requireOk(await execGit({ cwd, args: ["branch", "-m", status.branch, "main"] }), "rename branch to main");
  }
}

export async function switchToMain(input: { cwd: string }): Promise<{ ok: true }> {
  await ensureMainBranchInternal(input.cwd);
  return { ok: true };
}

export async function setupRepository(input: {
  cwd: string;
}): Promise<{ committed: boolean }> {
  const { cwd } = input;
  const statusBefore = await getStatus({ cwd });
  await ensureMainBranchInternal(cwd);

  if (statusBefore.hasWorkingTreeChanges) {
    requireOk(await execGit({ cwd, args: ["add", "-A"] }), "stage initial commit");
    requireOk(await execGit({ cwd, args: ["commit", "-m", "Initial commit"] }), "initial commit");
    return { committed: true };
  }

  return { committed: false };
}

export async function renameMasterToMain(input: { cwd: string }): Promise<{ ok: true }> {
  const { cwd } = input;
  requireOk(await execGit({ cwd, args: ["branch", "-m", "master", "main"] }), "rename master to main");
  requireOk(await execGit({ cwd, args: ["push", "-u", "origin", "main"] }), "push main");
  requireOk(await execGit({ cwd, args: ["remote", "set-head", "origin", "main"] }), "set origin head");
  requireOk(await execGit({ cwd, args: ["push", "origin", "--delete", "master"] }), "delete remote master");
  return { ok: true };
}

export async function createPreReleaseBranch(input: { cwd: string }): Promise<{ ok: true }> {
  const { cwd } = input;
  requireOk(await execGit({ cwd, args: ["checkout", "-b", "pre-release"] }), "create pre-release");
  if (await hasOriginRemote({ cwd })) {
    requireOk(await execGit({ cwd, args: ["push", "-u", "origin", "pre-release"] }), "push pre-release");
  }
  return { ok: true };
}
