import { execGit, readOriginRepoSlug, requireOk } from "./git-exec";

export async function push(input: {
  cwd: string;
  setUpstream?: boolean;
}): Promise<{ ok: true }> {
  const args = ["push"];
  if (input.setUpstream) {
    const branch = (await execGit({ cwd: input.cwd, args: ["branch", "--show-current"] })).stdout.trim();
    args.push("-u", "origin", branch);
  }
  requireOk(await execGit({ cwd: input.cwd, args, timeoutMs: 10 * 60_000 }), "push");
  return { ok: true };
}

export async function pull(input: { cwd: string }): Promise<{ ok: true }> {
  requireOk(await execGit({ cwd: input.cwd, args: ["pull", "--ff-only"], timeoutMs: 10 * 60_000 }), "pull");
  return { ok: true };
}

export async function fetch(input: { cwd: string }): Promise<{ ok: true }> {
  requireOk(await execGit({ cwd: input.cwd, args: ["fetch", "--prune"], timeoutMs: 10 * 60_000 }), "fetch");
  return { ok: true };
}

export async function hasOriginRemote(input: { cwd: string }): Promise<boolean> {
  const result = await execGit({ cwd: input.cwd, args: ["remote"] });
  return result.stdout.split("\n").some((remote) => remote.trim() === "origin");
}

export async function getOriginRepoSlugValue(input: { cwd: string }): Promise<string> {
  return readOriginRepoSlug(input.cwd);
}
