/**
 * Remote operations — push, pull, fetch.
 */
import { serverFetch } from "../server";

export async function push(
  cwd: string,
  setUpstream = false,
): Promise<void> {
  await serverFetch("/api/git/remote/push", { cwd, setUpstream });
}

export async function pull(cwd: string): Promise<void> {
  await serverFetch("/api/git/remote/pull", { cwd });
}

export async function fetch(cwd: string): Promise<void> {
  await serverFetch("/api/git/remote/fetch", { cwd });
}

export async function hasOriginRemote(cwd: string): Promise<boolean> {
  return serverFetch("/api/git/remote/has-origin", { cwd });
}

export async function getOriginRepoSlug(cwd: string): Promise<string> {
  return serverFetch("/api/git/remote/origin-slug", { cwd });
}
