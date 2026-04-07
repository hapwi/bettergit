/**
 * Remote operations — push, pull, fetch.
 */
import { execGit, requireSuccess } from "./exec";

export async function push(
  cwd: string,
  setUpstream = false,
): Promise<void> {
  const args = ["push"];
  if (setUpstream) {
    const branch = (await execGit(cwd, ["branch", "--show-current"])).stdout.trim();
    args.push("-u", "origin", branch);
  }
  requireSuccess(await execGit(cwd, args), "push");
}

export async function pull(cwd: string): Promise<void> {
  requireSuccess(await execGit(cwd, ["pull", "--ff-only"]), "pull");
}

export async function fetch(cwd: string): Promise<void> {
  requireSuccess(await execGit(cwd, ["fetch", "--prune"]), "fetch");
}

export async function hasOriginRemote(cwd: string): Promise<boolean> {
  const result = await execGit(cwd, ["remote"]);
  return result.stdout.split("\n").some((r) => r.trim() === "origin");
}
