import { serverFetch } from "../server";
import type { SemVer } from "../../../shared/workflows";
export type { SemVer } from "../../../shared/workflows";

export async function switchToMain(cwd: string): Promise<void> {
  await serverFetch("/api/git/setup/switch-main", { cwd });
}

export async function setupRepository(cwd: string): Promise<{ committed: boolean }> {
  return serverFetch("/api/git/setup/repository", { cwd });
}

export async function renameMasterToMain(cwd: string): Promise<void> {
  await serverFetch("/api/git/setup/rename-master-main", { cwd });
}

export async function createPreReleaseBranch(cwd: string): Promise<void> {
  await serverFetch("/api/git/setup/pre-release", { cwd });
}

export async function getPreReleaseAheadCount(cwd: string): Promise<number> {
  return serverFetch("/api/git/release/pre-release-ahead", { cwd });
}

export async function getCurrentVersion(cwd: string): Promise<SemVer> {
  return serverFetch("/api/git/release/current-version", { cwd });
}

export async function createReleasePullRequest(cwd: string): Promise<{
  number: number;
  title: string;
  url: string;
  baseBranch: string;
  headBranch: string;
  state: "open" | "closed" | "merged";
}> {
  return serverFetch("/api/git/release/create-pr", { cwd });
}
