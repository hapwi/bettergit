import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  XAxis,
} from "recharts";
import {
  GitCommitIcon,
  GitBranchIcon,
  UserIcon,
  Tag01Icon,
  GitPullRequestIcon,
  GitMergeIcon,
  Clock04Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDownRight, ArrowUpRight, FileIcon } from "lucide-react";
import { useAppStore } from "@/store";
import {
  getDashboardData,
} from "@/lib/git/stats";
import { gitStatusQueryOptions } from "@/lib/git/queries";
import { getGhViewer } from "@/lib/git/github";
import type { GitStatus } from "@/lib/git/status";
import { GitHubIcon } from "@/components/icons";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const activityConfig: ChartConfig = {
  commits: { label: "Commits", color: "var(--chart-1)" },
};

const changesConfig: ChartConfig = {
  insertions: { label: "Additions", color: "var(--chart-1)" },
  deletions: { label: "Deletions", color: "var(--chart-5)" },
};

type DashboardIcon = typeof GitCommitIcon;

function toSafeChartValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.round(parsed);
}

function formatDayLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }

  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatFullDate(date: string): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }

  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatRelativeTime(date: string): string {
  const parsed = new Date(date).getTime();
  if (Number.isNaN(parsed)) return "";

  const seconds = Math.floor((Date.now() - parsed) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: Math.abs(value) >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatSignedCompactNumber(value: number): string {
  const formatted = formatCompactNumber(Math.abs(value));
  return value > 0 ? `+${formatted}` : value < 0 ? `-${formatted}` : "0";
}

function normalizeIdentity(value?: string | null): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function displayAuthorName(value?: string | null): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "Unknown";
}

function getCommitStreak(status: { date: string; commits: number }[]): number {
  let streak = 0;
  for (let i = status.length - 1; i >= 0; i -= 1) {
    if (status[i]?.commits > 0) {
      streak += 1;
      continue;
    }
    break;
  }
  return streak;
}

function getWorkingTreeSummary(status: GitStatus | undefined) {
  const files = status?.workingTree.files ?? [];
  const staged = files.filter((file) => file.indexStatus !== "." && file.indexStatus !== "?").length;
  const modified = files.filter((file) => file.rawStatus !== "??" && file.workingTreeStatus !== ".").length;
  const untracked = files.filter((file) => file.rawStatus === "??").length;
  const renamed = files.filter((file) => file.displayStatus === "R").length;
  const deleted = files.filter((file) => file.displayStatus === "D").length;
  const sortedFiles = [...files].sort(
    (a, b) => b.insertions + b.deletions - (a.insertions + a.deletions),
  );

  return {
    files: sortedFiles,
    staged,
    modified,
    untracked,
    renamed,
    deleted,
  };
}


function SectionHeader({
  title,
  description,
  count,
  action,
}: {
  title: string;
  description?: string;
  count?: number;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          {count !== undefined ? (
            <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
          ) : null}
        </div>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

function EmptyState({
  icon,
  label,
}: {
  icon: DashboardIcon;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 border-t border-dashed border-border/60 py-5 text-xs text-muted-foreground/50">
      <HugeiconsIcon icon={icon} className="size-4" />
      <span>{label}</span>
    </div>
  );
}

function AvatarBadge({
  name,
  avatarUrl,
  size = "md",
}: {
  name: string;
  avatarUrl?: string;
  size?: "sm" | "md";
}) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?";
  const sizeClasses = size === "sm" ? "size-7 text-[10px]" : "size-8 text-[11px]";

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={`${name} avatar`}
        className={`${sizeClasses} rounded-full border border-border/60 object-cover`}
      />
    );
  }

  return (
    <div className={`${sizeClasses} flex items-center justify-center rounded-full border border-border/60 bg-muted/30 font-medium text-muted-foreground`}>
      {initials}
    </div>
  );
}

export function Dashboard({ isActive }: { isActive: boolean }) {
  const repoCwd = useAppStore((s) => s.repoCwd);
  const isEnabled = repoCwd !== null;
  const { data: ghViewer } = useQuery({
    queryKey: ["github", "viewer", repoCwd],
    queryFn: () => getGhViewer(repoCwd!),
    enabled: isEnabled,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchInterval: false,
  });

  const { data: status, isLoading: statusLoading } = useQuery(
    gitStatusQueryOptions(repoCwd, {
      enabled: isEnabled,
      refetchInterval: isActive ? undefined : false,
    }),
  );

  const { data: dashboardData, isLoading: dashboardLoading } = useQuery({
    queryKey: ["git", "dashboard-data", repoCwd],
    queryFn: () => getDashboardData(repoCwd!, 30, 15, 10),
    enabled: isEnabled,
    staleTime: 30_000,
    refetchInterval: isActive ? 60_000 : false,
  });

  const stats = dashboardData?.stats;
  const overview = dashboardData?.overview;
  const recentCommits = dashboardData?.recentCommits ?? [];
  const openPrs = dashboardData?.openPrs ?? [];
  const mergedPrs = dashboardData?.mergedPrs ?? [];

  const weeklyActivity = useMemo(() => {
    if (!stats) return [];
    const weeks: Array<{ week: string; commits: number }> = [];
    for (let i = 0; i < stats.dailyActivity.length; i += 7) {
      const slice = stats.dailyActivity.slice(i, i + 7);
      const commits = slice.reduce((sum, day) => sum + toSafeChartValue(day.commits), 0);
      const startDate = slice[0]?.date ?? "";
      weeks.push({ week: formatDayLabel(startDate), commits });
    }
    return weeks;
  }, [stats]);

  const recentChanges = useMemo(() => {
    if (!stats) return [];
    return stats.dailyActivity.slice(-14).map((day) => ({
      date: formatDayLabel(day.date),
      insertions: toSafeChartValue(day.insertions),
      deletions: toSafeChartValue(day.deletions),
    }));
  }, [stats]);

  const linesTouched = useMemo(
    () =>
      stats?.dailyActivity.reduce(
        (sum, day) => sum + toSafeChartValue(day.insertions) + toSafeChartValue(day.deletions),
        0,
      ) ?? 0,
    [stats],
  );

  const netLineDelta = useMemo(
    () =>
      stats?.dailyActivity.reduce(
        (sum, day) => sum + toSafeChartValue(day.insertions) - toSafeChartValue(day.deletions),
        0,
      ) ?? 0,
    [stats],
  );

  const activeStreak = useMemo(
    () => getCommitStreak(stats?.dailyActivity ?? []),
    [stats],
  );

  const workingTree = useMemo(
    () => getWorkingTreeSummary(status),
    [status],
  );

  const authorIdentity = useMemo(() => {
    const byLogin = new Map<string, { login?: string; avatarUrl?: string }>();
    const byName = new Map<string, { login?: string; avatarUrl?: string }>();

    for (const author of stats?.topAuthors ?? []) {
      const identity = { login: author.login, avatarUrl: author.avatarUrl };
      if (author.login) byLogin.set(normalizeIdentity(author.login), identity);
      byName.set(normalizeIdentity(author.name), identity);
    }

    if (ghViewer) {
      const viewerIdentity = { login: ghViewer.login, avatarUrl: ghViewer.avatarUrl };
      byLogin.set(normalizeIdentity(ghViewer.login), viewerIdentity);
    }

    return { byLogin, byName };
  }, [stats?.topAuthors, ghViewer]);

  const resolveAuthorIdentity = (author?: string | null) => {
    const normalized = normalizeIdentity(author);
    if (!normalized) return null;
    return (
      authorIdentity.byLogin.get(normalized) ??
      authorIdentity.byName.get(normalized) ??
      null
    );
  };

  const isLoading = dashboardLoading || statusLoading;

  if (!repoCwd) return null;

  if (isLoading) {
    return (
      <div className="flex flex-col gap-8 p-6">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Skeleton className="h-6 w-48 rounded-full" />
            <Skeleton className="h-4 w-32 rounded-md" />
          </div>
          <Skeleton className="h-8 w-full max-w-2xl rounded-md" />
        </div>
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <div className="space-y-6">
            <Skeleton className="h-52 rounded-xl" />
            <Skeleton className="h-52 rounded-xl" />
          </div>
          <div className="space-y-6">
            <Skeleton className="h-48 rounded-xl" />
            <Skeleton className="h-48 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!stats || !overview) return null;

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden" style={{ scrollbarWidth: "none" }}>
      <div className="mx-auto flex max-w-7xl flex-col gap-10 px-6 pb-12 pt-6">
        <section className="space-y-2 pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono text-xs">
              <HugeiconsIcon icon={GitBranchIcon} className="size-3" />
              {status?.branch ?? (status?.isDetached ? "Detached HEAD" : "No branch")}
            </Badge>
            {overview.release.currentVersion ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Badge variant="secondary" className="font-mono text-xs">
                      <HugeiconsIcon icon={Tag01Icon} className="size-3" />
                      v{overview.release.currentVersion}
                    </Badge>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {overview.release.latestTagRelative ?? "Latest release"}
                </TooltipContent>
              </Tooltip>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums text-muted-foreground">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-default">
                  <span className="font-semibold text-foreground">{formatCompactNumber(stats.totalCommits)}</span> commits
                </span>
              </TooltipTrigger>
              <TooltipContent>{stats.dailyActivity.filter((d) => d.commits > 0).length} active days in 30 days</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-default">
                  <span className="font-semibold text-foreground">{formatCompactNumber(linesTouched)}</span> lines
                </span>
              </TooltipTrigger>
              <TooltipContent>Insertions + deletions over 30 days</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-default">
                  <span className="font-semibold text-foreground">{formatSignedCompactNumber(netLineDelta)}</span> net
                </span>
              </TooltipTrigger>
              <TooltipContent>Added lines minus deleted lines</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-default">
                  <span className="font-semibold text-foreground">{openPrs.length}</span> PR{openPrs.length === 1 ? "" : "s"}
                </span>
              </TooltipTrigger>
              <TooltipContent>{mergedPrs.length} recently merged</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-default">
                  <span className="font-semibold text-foreground">{activeStreak}d</span> streak
                </span>
              </TooltipTrigger>
              <TooltipContent>Consecutive active days</TooltipContent>
            </Tooltip>
          </div>
        </section>

        <section className="grid gap-8 border-b border-border/60 pb-8 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <div className="space-y-8">
            <Card>
              <CardContent className="space-y-4">
              <SectionHeader
                title="Commit activity"
                description="Weekly cadence over the last 30 days."
              />
              {weeklyActivity.length > 0 ? (
                isActive ? (
                  <ChartContainer config={activityConfig} className="h-56 w-full">
                    <BarChart data={weeklyActivity} margin={{ top: 8, right: 4, bottom: 0, left: -20 }}>
                      <XAxis dataKey="week" tickLine={false} axisLine={false} fontSize={10} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="commits" fill="var(--color-commits)" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ChartContainer>
                ) : (
                  <div className="h-56 w-full" />
                )
              ) : (
                <EmptyState icon={GitCommitIcon} label="No activity in the last 30 days" />
              )}
            </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-4">
              <SectionHeader
                title="Code change volume"
                description="Additions and deletions across the last 14 days."
              />
              {recentChanges.some((day) => day.insertions > 0 || day.deletions > 0) ? (
                isActive ? (
                  <ChartContainer config={changesConfig} className="h-56 w-full">
                    <AreaChart data={recentChanges} margin={{ top: 8, right: 4, bottom: 0, left: -20 }}>
                      <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={10} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <defs>
                        <linearGradient id="overviewInsertions" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--color-insertions)" stopOpacity={0.28} />
                          <stop offset="100%" stopColor="var(--color-insertions)" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="overviewDeletions" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--color-deletions)" stopOpacity={0.24} />
                          <stop offset="100%" stopColor="var(--color-deletions)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <Area
                        type="monotone"
                        dataKey="insertions"
                        stroke="var(--color-insertions)"
                        fill="url(#overviewInsertions)"
                        strokeWidth={2}
                      />
                      <Area
                        type="monotone"
                        dataKey="deletions"
                        stroke="var(--color-deletions)"
                        fill="url(#overviewDeletions)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ChartContainer>
                ) : (
                  <div className="h-56 w-full" />
                )
              ) : (
                <EmptyState icon={GitMergeIcon} label="No code changes in the last 14 days" />
              )}
            </CardContent>
            </Card>
          </div>

          <div className="space-y-8">
            <div className="space-y-4">
              <SectionHeader
                title="Working tree health"
                description="What is changed locally right now."
              />
              <div className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border/60 pt-4">
                {[
                  { label: "Changed files", value: workingTree.files.length, tone: "default" },
                  { label: "Staged", value: workingTree.staged, tone: "positive" },
                  { label: "Modified", value: workingTree.modified, tone: "positive" },
                  { label: "Untracked", value: workingTree.untracked, tone: "warning" },
                  { label: "Renamed", value: workingTree.renamed, tone: "default" },
                  { label: "Deleted", value: workingTree.deleted, tone: "danger" },
                ].map((item) => (
                  <div key={item.label}>
                    <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground/60">
                      {item.label}
                    </div>
                    <div className="mt-1 text-xl font-semibold tabular-nums text-foreground">
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>

              {workingTree.files.length > 0 ? (
                <div className="divide-y border-t border-border/60">
                  {workingTree.files.slice(0, 5).map((file) => (
                    <div key={file.path} className="flex items-center gap-3 py-3 text-sm">
                      <span
                        className={`w-5 text-xs font-medium ${
                          file.displayStatus === "D"
                            ? "text-rose-300"
                            : file.rawStatus === "??"
                              ? "text-amber-700 dark:text-amber-300"
                              : "text-emerald-400"
                        }`}
                      >
                        {file.displayStatus}
                      </span>
                      <span className="flex-1 truncate font-mono text-xs text-foreground/85">
                        {file.path}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatCompactNumber(file.insertions + file.deletions)} lines
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState icon={GitBranchIcon} label="No local file changes" />
              )}
            </div>

            <div className="space-y-4">
              <SectionHeader
                title="File hotspots"
                description="Files with the most churn over the last 30 days."
              />
              {overview.hotspots.length > 0 ? (
                <div className="divide-y border-t border-border/60">
                  {overview.hotspots.map((file) => (
                    <div key={file.path} className="flex items-center gap-3 py-3">
                      <FileIcon className="size-4 shrink-0 text-muted-foreground/50" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{file.path}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {file.commits} commit{file.commits === 1 ? "" : "s"} touched this file
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-sm font-semibold tabular-nums">
                          {formatCompactNumber(file.totalChanges)}
                        </div>
                        <div className="flex items-center justify-end gap-2 text-[11px] text-muted-foreground">
                          <span className="inline-flex items-center gap-1 text-emerald-400">
                            <ArrowUpRight className="size-3" />
                            {formatCompactNumber(file.insertions)}
                          </span>
                          <span className="inline-flex items-center gap-1 text-rose-300">
                            <ArrowDownRight className="size-3" />
                            {formatCompactNumber(file.deletions)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState icon={GitCommitIcon} label="No hotspot files in the selected range" />
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-8 border-b border-border/60 pb-8 xl:grid-cols-2">
          <div className="space-y-4">
            <SectionHeader
              title="Open pull requests"
              description="Current review and merge queue."
              count={openPrs.length}
            />
            {openPrs.length > 0 ? (
              <div className="divide-y border-t border-border/60">
                {openPrs.map((pr) => (
                  <div key={pr.number} className="flex items-center gap-3 py-3">
                    <HugeiconsIcon icon={GitPullRequestIcon} className="size-4 shrink-0 text-emerald-500" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        #{pr.number} {pr.title}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        {(() => {
                          const authorName = displayAuthorName(pr.author);
                          return (
                        <span className="inline-flex items-center gap-1.5">
                          <AvatarBadge
                            name={authorName}
                            avatarUrl={resolveAuthorIdentity(pr.author)?.avatarUrl}
                            size="sm"
                          />
                          <span>{authorName}</span>
                        </span>
                          );
                        })()}
                        <span>{pr.headBranch} → {pr.baseBranch}</span>
                        <span>Updated {formatRelativeTime(pr.updatedAt)}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 rounded-md p-1 text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground"
                      onClick={() => void window.electronAPI?.shell.openExternal(pr.url)}
                      title="Open pull request"
                    >
                      <GitHubIcon className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={GitPullRequestIcon} label="No open pull requests" />
            )}
          </div>

          <div className="space-y-4">
            <SectionHeader
              title="Recently merged"
              description="Latest merged pull requests."
              count={mergedPrs.length}
            />
            {mergedPrs.length > 0 ? (
              <div className="divide-y border-t border-border/60">
                {mergedPrs.slice(0, 5).map((pr) => {
                  const authorName = displayAuthorName(pr.author);
                  return (
                  <div key={pr.number} className="flex items-center gap-3 py-3">
                    <HugeiconsIcon icon={GitMergeIcon} className="size-4 shrink-0 text-violet-400" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 truncate text-sm font-medium">
                        <span className="truncate">#{pr.number} {pr.title}</span>
                        {pr.tag ? (
                          <Badge variant="secondary" className="shrink-0 font-mono text-[10px]">{pr.tag}</Badge>
                        ) : null}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          <AvatarBadge
                            name={authorName}
                            avatarUrl={resolveAuthorIdentity(pr.author)?.avatarUrl}
                            size="sm"
                          />
                          <span>{authorName}</span>
                        </span>
                        <span>{pr.headBranch} → {pr.baseBranch}</span>
                        <span>Merged {formatRelativeTime(pr.updatedAt)}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 rounded-md p-1 text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground"
                      onClick={() => void window.electronAPI?.shell.openExternal(pr.url)}
                      title="Open pull request"
                    >
                      <GitHubIcon className="size-3.5" />
                    </button>
                  </div>
                  );
                })}
                {mergedPrs.length > 5 ? (
                  <div className="pt-3 text-xs text-muted-foreground">
                    Showing latest merged pull requests
                  </div>
                ) : null}
              </div>
            ) : (
              <EmptyState icon={GitMergeIcon} label="No recently merged pull requests" />
            )}
          </div>
        </section>

        <section className="grid gap-8 border-b border-border/60 pb-8 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
          <div className="space-y-4">
            <SectionHeader
              title="Recent commits"
              description="Latest authored commits on this repo."
              count={recentCommits.length}
            />
            {recentCommits.length > 0 ? (
              <div className="divide-y border-t border-border/60">
                {recentCommits.slice(0, 6).map((commit) => {
                  const authorName = displayAuthorName(commit.author);
                  return (
                  <div key={commit.sha} className="flex items-center gap-3 py-3">
                    <HugeiconsIcon icon={GitCommitIcon} className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{commit.subject}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          <AvatarBadge
                            name={authorName}
                            avatarUrl={resolveAuthorIdentity(commit.author)?.avatarUrl}
                            size="sm"
                          />
                          <span>{authorName}</span>
                        </span>
                        <span className="font-mono text-foreground/60">{commit.shortSha}</span>
                        <span>{formatRelativeTime(commit.date)}</span>
                      </div>
                    </div>
                  </div>
                  );
                })}
                {recentCommits.length > 6 ? (
                  <div className="pt-3 text-xs text-muted-foreground">
                    Showing 6 of {recentCommits.length} recent commits
                  </div>
                ) : null}
              </div>
            ) : (
              <EmptyState icon={Clock04Icon} label="No commits found" />
            )}
          </div>

          <div className="space-y-8">
            <div className="space-y-4">
              <SectionHeader
                title="Branch sprawl"
                description="Local branches that have not moved in at least two weeks."
                count={overview.staleBranchCount}
              />
              {overview.staleBranches.length > 0 ? (
                <div className="divide-y border-t border-border/60">
                  {overview.staleBranches.map((branch) => (
                    <div key={branch.name} className="flex items-center gap-3 py-3">
                      <HugeiconsIcon
                        icon={GitBranchIcon}
                        className={`size-4 shrink-0 ${branch.merged ? "text-muted-foreground" : "text-amber-700 dark:text-amber-300"}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{branch.name}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                          <span>Last commit {branch.lastCommitRelative}</span>
                          <span>{formatFullDate(branch.lastCommitDate)}</span>
                        </div>
                      </div>
                      <Badge variant={branch.merged ? "outline" : "secondary"} className="shrink-0 text-[10px]">
                        {branch.merged ? "Merged" : "Unmerged"}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState icon={GitBranchIcon} label="No stale local branches" />
              )}
            </div>

            <div className="space-y-4">
              <SectionHeader
                title="Recent tags"
                description="Latest release markers from the repository."
                count={stats.recentTags.length}
              />
              {stats.recentTags.length > 0 ? (
                <div className="divide-y border-t border-border/60">
                  {stats.recentTags.map((tag, index) => (
                    <div key={tag} className="flex items-center gap-3 py-3">
                      <HugeiconsIcon icon={Tag01Icon} className="size-4 shrink-0 text-muted-foreground/70" />
                      <span className="flex-1 truncate font-mono text-xs">{tag}</span>
                      {index === 0 ? (
                        <Badge variant="outline" className="text-[10px]">
                          Latest
                        </Badge>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState icon={Tag01Icon} label="No release tags found" />
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-8 xl:grid-cols-2">
          <div className="space-y-4">
            <SectionHeader
              title="Contributor mix"
              description="Share of commits over the last 30 days."
              count={stats.topAuthors.length}
              action={ghViewer ? (
                <a
                  href={ghViewer.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/20 px-2.5 py-1.5 text-xs transition-colors hover:bg-muted/30"
                >
                  <AvatarBadge name={ghViewer.login} avatarUrl={ghViewer.avatarUrl} size="sm" />
                  <span className="text-muted-foreground">Connected as</span>
                  <span className="font-medium text-foreground">{ghViewer.login}</span>
                </a>
              ) : undefined}
            />
            {stats.topAuthors.length > 0 ? (
              <div className="divide-y border-t border-border/60">
                {stats.topAuthors.slice(0, 6).map((author) => {
                  const share = stats.totalCommits > 0 ? Math.round((author.commits / stats.totalCommits) * 100) : 0;
                  const authorName = displayAuthorName(author.name);
                  const loginName = author.login?.trim() ?? "";
                  const showSecondaryLogin =
                    loginName.length > 0 && normalizeIdentity(loginName) !== normalizeIdentity(authorName);
                  const isViewer =
                    ghViewer &&
                    ((author.login && normalizeIdentity(ghViewer.login) === normalizeIdentity(author.login)) ||
                      normalizeIdentity(ghViewer.login) === normalizeIdentity(author.name));
                  return (
                    <div key={author.login ?? authorName} className="space-y-2 py-3">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <div className="flex min-w-0 items-center gap-3">
                          <AvatarBadge
                            name={author.login ?? authorName}
                            avatarUrl={author.avatarUrl ?? (isViewer ? ghViewer?.avatarUrl : undefined)}
                          />
                          <div className="min-w-0">
                            <div className="truncate font-medium">
                              {authorName}
                              {isViewer ? <span className="ml-2 text-xs text-muted-foreground">You</span> : null}
                            </div>
                            {showSecondaryLogin ? (
                              <div className="truncate text-[11px] text-muted-foreground">{loginName}</div>
                            ) : null}
                          </div>
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {author.commits} commits · {share}%
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted/50">
                        <div
                          className="h-full rounded-full bg-foreground/85 transition-[width] duration-300"
                          style={{ width: `${Math.max(share, share > 0 ? 8 : 0)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState icon={UserIcon} label="No contributor data available" />
            )}
          </div>

          <div className="space-y-4">
            <SectionHeader
              title="Release runway"
              description="Version context and pace toward the next cut."
            />
            <div className="divide-y border-t border-border/60">
              <div className="flex items-center justify-between gap-4 py-3">
                <span className="text-sm text-muted-foreground">Current version</span>
                <span className="text-sm font-medium">
                  {overview.release.currentVersion ? `v${overview.release.currentVersion}` : "Not versioned"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4 py-3">
                <span className="text-sm text-muted-foreground">Latest release</span>
                <span className="text-sm font-medium">
                  {overview.release.latestTag ?? "No tags yet"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4 py-3">
                <span className="text-sm text-muted-foreground">Published</span>
                <span className="text-right text-sm font-medium">
                  {overview.release.latestTagDate ? formatFullDate(overview.release.latestTagDate) : "No release date"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4 py-3">
                <span className="text-sm text-muted-foreground">Unreleased commits</span>
                <span className="text-sm font-medium">
                  {overview.release.commitsSinceLatestTag}
                </span>
              </div>
              {(() => {
                const commits = overview.release.commitsSinceLatestTag;
                const daysSince = overview.release.latestTagDate
                  ? Math.floor((Date.now() - new Date(overview.release.latestTagDate).getTime()) / (1000 * 60 * 60 * 24))
                  : null;
                const hasTag = Boolean(overview.release.latestTag);

                let label: string;
                let tone: string;

                if (!hasTag) {
                  label = "No releases yet — consider tagging your first version.";
                  tone = "text-muted-foreground";
                } else if (commits === 0) {
                  label = "Fully released — no unreleased changes.";
                  tone = "text-emerald-600 dark:text-emerald-400";
                } else if (commits <= 3 && (daysSince === null || daysSince < 7)) {
                  label = "A few changes — no rush, but a patch release could be cut soon.";
                  tone = "text-muted-foreground";
                } else if (commits <= 10 || (daysSince !== null && daysSince < 14)) {
                  label = `${commits} unreleased commits — consider a patch release.`;
                  tone = "text-amber-700 dark:text-amber-400";
                } else if (commits <= 30) {
                  label = `${commits} commits over ${daysSince ?? "?"}d — a minor release is recommended.`;
                  tone = "text-amber-700 dark:text-amber-400";
                } else {
                  label = `${commits} commits over ${daysSince ?? "?"}d — a minor or major release is overdue.`;
                  tone = "text-rose-600 dark:text-rose-400";
                }

                return (
                  <div className="py-3">
                    <p className={`text-xs font-medium ${tone}`}>{label}</p>
                  </div>
                );
              })()}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
