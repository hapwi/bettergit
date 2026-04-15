/**
 * React Query options for git operations.
 */
import { queryOptions, keepPreviousData, type QueryClient } from "@tanstack/react-query";
import { getStatus } from "./status";
import { listBranches } from "./branches";
import { getFullDiffPatch } from "./commits";
import { listOpenPullRequests } from "./github";
import type { GitStatus } from "./status";

export const gitQueryKeys = {
  all: ["git"] as const,
  status: (cwd: string | null) => ["git", "status", cwd] as const,
  branches: (cwd: string | null) => ["git", "branches", cwd] as const,
  diffPatch: (cwd: string | null) => ["git", "diffPatch", cwd] as const,
  openPrs: (cwd: string | null) => ["git", "open-prs", cwd] as const,
};

const STATUS_FAST_POLL_MS = 5_000;
const STATUS_MEDIUM_POLL_MS = 15_000;
const STATUS_IDLE_POLL_MS = 30_000;
const BRANCHES_POLL_MS = 60_000;
const OPEN_PRS_POLL_MS = 60_000;

function isWindowVisible(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState === "visible";
}

function resolveStatusRefetchInterval(status: GitStatus | undefined): number | false {
  if (!isWindowVisible()) return false;
  if (!status) return STATUS_MEDIUM_POLL_MS;

  if (
    status.hasWorkingTreeChanges ||
    status.aheadCount > 0 ||
    status.behindCount > 0 ||
    !status.hasCommits
  ) {
    return STATUS_FAST_POLL_MS;
  }

  if (!status.hasUpstream || !status.hasOriginRemote) {
    return STATUS_MEDIUM_POLL_MS;
  }

  return STATUS_IDLE_POLL_MS;
}

function resolveVisibleRefetchInterval(intervalMs: number): number | false {
  return isWindowVisible() ? intervalMs : false;
}

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
    refetchInterval: (query) => {
      if (options?.refetchInterval !== undefined) return options.refetchInterval;
      return resolveStatusRefetchInterval(query.state.data as GitStatus | undefined);
    },
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
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
    refetchInterval: () => resolveVisibleRefetchInterval(BRANCHES_POLL_MS),
    refetchIntervalInBackground: false,
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
    networkMode: "online",
    refetchInterval: () => resolveVisibleRefetchInterval(OPEN_PRS_POLL_MS),
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
  });
}
