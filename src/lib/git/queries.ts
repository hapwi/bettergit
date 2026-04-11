/**
 * React Query options for git operations.
 */
import { queryOptions, keepPreviousData, type QueryClient } from "@tanstack/react-query";
import { getStatus } from "./status";
import { listBranches } from "./branches";
import { getFullDiffPatch } from "./commits";
import { listOpenPullRequests } from "./github";

export const gitQueryKeys = {
  all: ["git"] as const,
  status: (cwd: string | null) => ["git", "status", cwd] as const,
  branches: (cwd: string | null) => ["git", "branches", cwd] as const,
  diffPatch: (cwd: string | null) => ["git", "diffPatch", cwd] as const,
  openPrs: (cwd: string | null) => ["git", "open-prs", cwd] as const,
};

export function invalidateGitQueries(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    queryKey: gitQueryKeys.all,
    refetchType: "active",
  });
}

export function gitStatusQueryOptions(
  cwd: string | null,
  options?: {
    enabled?: boolean;
    refetchInterval?: number | false;
  },
) {
  return queryOptions({
    queryKey: gitQueryKeys.status(cwd),
    queryFn: () => getStatus(cwd!),
    enabled: options?.enabled ?? cwd !== null,
    staleTime: 10_000,
    gcTime: 5 * 60_000,
    refetchInterval: options?.refetchInterval ?? 5_000,
    refetchOnWindowFocus: "always" as const,
    placeholderData: keepPreviousData,
  });
}

export function gitDiffPatchQueryOptions(cwd: string | null, enabled: boolean) {
  return queryOptions({
    queryKey: gitQueryKeys.diffPatch(cwd),
    queryFn: () => getFullDiffPatch(cwd!),
    enabled: cwd !== null && enabled,
    staleTime: 5_000,
    gcTime: 60_000,
  });
}

export function gitBranchesQueryOptions(
  cwd: string | null,
  options?: {
    enabled?: boolean;
  },
) {
  return queryOptions({
    queryKey: gitQueryKeys.branches(cwd),
    queryFn: () => listBranches(cwd!),
    enabled: options?.enabled ?? cwd !== null,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function gitOpenPrsQueryOptions(
  cwd: string | null,
  options?: {
    enabled?: boolean;
  },
) {
  return queryOptions({
    queryKey: gitQueryKeys.openPrs(cwd),
    queryFn: () => listOpenPullRequests(cwd!, ""),
    enabled: options?.enabled ?? cwd !== null,
    staleTime: 15_000,
    gcTime: 5 * 60_000,
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });
}
