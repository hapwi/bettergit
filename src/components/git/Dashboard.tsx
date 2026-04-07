import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  Area,
  AreaChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Pie,
  PieChart,
  Cell,
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
import { useAppStore } from "@/store";
import { getRepoStats, getRecentCommits, getOpenPrs, getMergedPrs } from "@/lib/git/stats";
import { getOriginRepoSlug } from "@/lib/git/remote";
import { execGh } from "@/lib/git/exec";
import { GitHubIcon } from "@/components/icons";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

const activityConfig: ChartConfig = {
  commits: { label: "Commits", color: "var(--chart-1)" },
};

const changesConfig: ChartConfig = {
  insertions: { label: "Additions", color: "var(--chart-1)" },
  deletions: { label: "Deletions", color: "var(--chart-5)" },
};

const PIE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function SectionTitle({
  icon,
  title,
  count,
}: {
  icon: typeof GitCommitIcon;
  title: string;
  count?: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <HugeiconsIcon icon={icon} className="size-4 text-muted-foreground" />
      <h3 className="text-sm font-semibold">{title}</h3>
      {count !== undefined && (
        <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
      )}
    </div>
  );
}

export function Dashboard() {
  const repoCwd = useAppStore((s) => s.repoCwd);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["git", "stats", repoCwd],
    queryFn: () => getRepoStats(repoCwd!, 30),
    enabled: repoCwd !== null,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
  const { data: recentCommits = [] } = useQuery({
    queryKey: ["git", "recent-commits", repoCwd],
    queryFn: () => getRecentCommits(repoCwd!, 15),
    enabled: repoCwd !== null,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const { data: openPrs = [] } = useQuery({
    queryKey: ["git", "open-prs", repoCwd],
    queryFn: () => getOpenPrs(repoCwd!),
    enabled: repoCwd !== null,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const { data: forkInfo } = useQuery({
    queryKey: ["git", "fork-info", repoCwd],
    queryFn: async () => {
      const repo = await getOriginRepoSlug(repoCwd!);
      if (!repo) return null;
      const result = await execGh(repoCwd!, ["repo", "view", repo, "--json", "isFork,parent"]);
      if (result.code !== 0) return null;
      const data = JSON.parse(result.stdout) as { isFork: boolean; parent?: { name: string; owner: { login: string } } };
      if (!data.isFork || !data.parent) return null;
      return `${data.parent.owner.login}/${data.parent.name}`;
    },
    enabled: repoCwd !== null,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
  });

  const { data: mergedPrs = [] } = useQuery({
    queryKey: ["git", "merged-prs", repoCwd],
    queryFn: () => getMergedPrs(repoCwd!, 10),
    enabled: repoCwd !== null,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const weeklyActivity = useMemo(() => {
    if (!stats) return [];
    const weeks: Array<{ week: string; commits: number }> = [];
    for (let i = 0; i < stats.dailyActivity.length; i += 7) {
      const slice = stats.dailyActivity.slice(i, i + 7);
      const commits = slice.reduce((sum, d) => sum + d.commits, 0);
      const startDate = slice[0]?.date ?? "";
      const label = new Date(startDate + "T00:00:00").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      weeks.push({ week: label, commits });
    }
    return weeks;
  }, [stats]);

  const recentChanges = useMemo(() => {
    if (!stats) return [];
    return stats.dailyActivity.slice(-14).map((d) => ({
      date: new Date(d.date + "T00:00:00").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      insertions: d.insertions,
      deletions: d.deletions,
    }));
  }, [stats]);

  if (!repoCwd) return null;

  if (statsLoading) {
    return (
      <div className="flex flex-col gap-5 p-6">
        <Skeleton className="h-16 rounded-xl" />
        <div className="grid grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-56 rounded-xl" />
          <Skeleton className="h-56 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-5 p-6">
        {/* Fork indicator */}
        {forkInfo && (
          <button
            type="button"
            className="flex items-center gap-2 text-xs text-muted-foreground/60 transition-colors hover:text-muted-foreground"
            onClick={() => void window.electronAPI?.shell.openExternal(`https://github.com/${forkInfo}`)}
          >
            <GitHubIcon className="size-3" />
            <span>Forked from <span className="font-medium">{forkInfo}</span></span>
          </button>
        )}

        {/* Stat row */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Commits", value: stats.totalCommits, icon: GitCommitIcon },
            { label: "Branches", value: stats.totalBranches, icon: GitBranchIcon },
            { label: "Contributors", value: stats.topAuthors.length, icon: UserIcon },
            { label: "Open PRs", value: openPrs.length, icon: GitPullRequestIcon },
          ].map((stat) => (
            <div key={stat.label} className="flex items-center gap-3 rounded-xl border bg-card/50 px-4 py-3">
              <HugeiconsIcon icon={stat.icon} className="size-4 text-muted-foreground" />
              <div>
                <p className="text-xl font-bold tabular-nums">{stat.value}</p>
                <p className="text-[11px] text-muted-foreground">{stat.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Commit Activity</CardTitle>
              <CardDescription className="text-[11px]">Weekly, last 30 days</CardDescription>
            </CardHeader>
            <CardContent>
              {weeklyActivity.length > 0 ? (
                <ChartContainer config={activityConfig} className="h-40 w-full">
                  <BarChart data={weeklyActivity} margin={{ top: 8, right: 4, bottom: 0, left: -20 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border/30" />
                    <XAxis dataKey="week" tickLine={false} axisLine={false} fontSize={10} />
                    <YAxis tickLine={false} axisLine={false} fontSize={10} allowDecimals={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="commits" fill="var(--color-commits)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              ) : (
                <div className="flex h-40 items-center justify-center text-xs text-muted-foreground/50">No activity</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Code Changes</CardTitle>
              <CardDescription className="text-[11px]">Additions & deletions, last 14 days</CardDescription>
            </CardHeader>
            <CardContent>
              {recentChanges.some((d) => d.insertions > 0 || d.deletions > 0) ? (
                <ChartContainer config={changesConfig} className="h-40 w-full">
                  <AreaChart data={recentChanges} margin={{ top: 8, right: 4, bottom: 0, left: -20 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border/30" />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={10} />
                    <YAxis tickLine={false} axisLine={false} fontSize={10} allowDecimals={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <defs>
                      <linearGradient id="fillIns" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-insertions)" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="var(--color-insertions)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="fillDel" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-deletions)" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="var(--color-deletions)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area type="monotone" dataKey="insertions" stroke="var(--color-insertions)" fill="url(#fillIns)" strokeWidth={2} />
                    <Area type="monotone" dataKey="deletions" stroke="var(--color-deletions)" fill="url(#fillDel)" strokeWidth={2} />
                  </AreaChart>
                </ChartContainer>
              ) : (
                <div className="flex h-40 items-center justify-center text-xs text-muted-foreground/50">No changes</div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Open PRs */}
        <div className="flex flex-col gap-3">
          <SectionTitle icon={GitPullRequestIcon} title="Open Pull Requests" count={openPrs.length} />
          {openPrs.length > 0 ? (
            <Card>
              <CardContent className="p-0">
                <div className="divide-y">
                  {openPrs.map((pr) => (
                    <div
                      key={pr.number}
                      className="flex w-full items-center gap-3 px-4 py-2.5"
                    >
                      <HugeiconsIcon icon={GitPullRequestIcon} className="size-4 shrink-0 text-emerald-500" />
                      <span className="text-xs font-medium text-muted-foreground">#{pr.number}</span>
                      <span className="truncate text-sm font-medium">{pr.title}</span>
                      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground/50">
                        {pr.headBranch} → {pr.baseBranch}
                      </span>
                      <Badge variant="default" className="shrink-0 text-[10px]">Open</Badge>
                      <button
                        type="button"
                        className="shrink-0 rounded-md p-1 text-muted-foreground/40 transition-colors hover:bg-accent hover:text-foreground"
                        onClick={() => void window.electronAPI?.shell.openExternal(pr.url)}
                      >
                        <GitHubIcon className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-dashed py-6 justify-center text-muted-foreground/40">
              <HugeiconsIcon icon={GitPullRequestIcon} className="size-4" />
              <span className="text-xs">No open pull requests</span>
            </div>
          )}
        </div>

        {/* Recent commits */}
        <div className="flex flex-col gap-3">
          <SectionTitle icon={Clock04Icon} title="Recent Commits" count={recentCommits.length} />
          {recentCommits.length > 0 ? (
            <Card>
              <CardContent className="p-0">
                <div className="divide-y">
                  {recentCommits.slice(0, 10).map((commit) => (
                    <div key={commit.sha} className="flex items-center gap-3 px-4 py-2.5">
                      <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                        {commit.shortSha}
                      </Badge>
                      <p className="flex-1 truncate text-sm">{commit.subject}</p>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{commit.author}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground/50">{commit.relativeDate}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : (
            <p className="text-xs text-muted-foreground/50">No commits found</p>
          )}
        </div>

        {/* Merged PRs */}
        <div className="flex flex-col gap-3">
          <SectionTitle icon={GitMergeIcon} title="Recently Merged" count={mergedPrs.length} />
          {mergedPrs.length > 0 ? (
            <Card>
              <CardContent className="p-0">
                <div className="divide-y">
                  {mergedPrs.map((pr) => (
                    <div
                      key={pr.number}
                      className="flex w-full items-center gap-3 px-4 py-2.5"
                    >
                      <HugeiconsIcon icon={GitMergeIcon} className="size-4 shrink-0 text-purple-400" />
                      <span className="text-xs font-medium text-muted-foreground">#{pr.number}</span>
                      <span className="truncate text-sm">{pr.title}</span>
                      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground/50">
                        {pr.headBranch} → {pr.baseBranch}
                      </span>
                      <Badge variant="secondary" className="shrink-0 text-[10px] text-purple-400">Merged</Badge>
                      <button
                        type="button"
                        className="shrink-0 rounded-md p-1 text-muted-foreground/40 transition-colors hover:bg-accent hover:text-foreground"
                        onClick={() => void window.electronAPI?.shell.openExternal(pr.url)}
                      >
                        <GitHubIcon className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-dashed py-6 justify-center text-muted-foreground/40">
              <HugeiconsIcon icon={GitMergeIcon} className="size-4" />
              <span className="text-xs">No recently merged PRs</span>
            </div>
          )}
        </div>

        {/* Bottom row: contributors + tags */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Contributors</CardTitle>
              <CardDescription className="text-[11px]">By commits (30d)</CardDescription>
            </CardHeader>
            <CardContent>
              {stats.topAuthors.length > 0 ? (
                <div className="flex items-center gap-6">
                  <ChartContainer config={{ commits: { label: "Commits", color: "var(--chart-2)" } }} className="h-32 w-32 shrink-0">
                    <PieChart>
                      <Pie
                        data={stats.topAuthors}
                        dataKey="commits"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={24}
                        outerRadius={50}
                        paddingAngle={3}
                        strokeWidth={0}
                      >
                        {stats.topAuthors.map((_entry, index) => (
                          <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
                    </PieChart>
                  </ChartContainer>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    {stats.topAuthors.slice(0, 5).map((author, i) => (
                      <div key={author.name} className="flex items-center gap-2">
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                        />
                        <span className="flex-1 truncate text-xs">{author.name}</span>
                        <span className="text-xs tabular-nums text-muted-foreground">{author.commits}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex h-32 items-center justify-center text-xs text-muted-foreground/50">No contributors</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Recent Tags</CardTitle>
              <CardDescription className="text-[11px]">Latest releases</CardDescription>
            </CardHeader>
            <CardContent>
              {stats.recentTags.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {stats.recentTags.map((tag, i) => (
                    <div key={tag} className="flex items-center gap-2 rounded-lg bg-muted/30 px-3 py-2">
                      <HugeiconsIcon icon={Tag01Icon} className="size-3 shrink-0 text-muted-foreground/50" />
                      <span className="flex-1 truncate font-mono text-xs">{tag}</span>
                      {i === 0 && <Badge variant="default" className="text-[9px]">Latest</Badge>}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex h-32 items-center justify-center text-xs text-muted-foreground/50">No tags</div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </ScrollArea>
  );
}
