/**
 * Branch operations — list, create, delete, checkout.
 */
import { serverFetch } from "../server";

export interface Branch {
  name: string;
  current: boolean;
  isRemote: boolean;
  isDefault: boolean;
  upstream: string | null;
}

export async function listBranches(cwd: string): Promise<Branch[]> {
  return serverFetch("/api/git/branches/list", { cwd });
}

export async function getDefaultBranch(cwd: string): Promise<string> {
  return serverFetch("/api/git/branches/default", { cwd });
}

export async function getCurrentBranch(cwd: string): Promise<string | null> {
  return serverFetch("/api/git/branches/current", { cwd });
}

export async function checkoutBranch(cwd: string, branch: string): Promise<void> {
  await serverFetch("/api/git/branches/checkout", { cwd, branch });
}

export async function createBranch(
  cwd: string,
  branch: string,
  startPoint?: string,
): Promise<void> {
  await serverFetch("/api/git/branches/create", { cwd, branch, startPoint });
}

export async function deleteBranch(
  cwd: string,
  branch: string,
  force = false,
): Promise<void> {
  await serverFetch("/api/git/branches/delete", { cwd, branch, force });
}
