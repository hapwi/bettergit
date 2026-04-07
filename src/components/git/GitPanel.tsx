import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  GitBranchIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  Upload04Icon,
  GitCommitIcon,
  ArrowDown01Icon,
  LinkSquare01Icon,
  InformationCircleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useAppStore } from "@/store";
import { cn } from "@/lib/utils";
import {
  gitStatusQueryOptions,
  gitBranchesQueryOptions,
  invalidateGitQueries,
} from "@/lib/git/queries";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { runStackedAction, type StackedAction } from "@/lib/git/stacked";
import { pull } from "@/lib/git/remote";
import { checkoutBranch, deleteBranch } from "@/lib/git/branches";
import { mergePullRequest, createPullRequest, type PullRequestSummary } from "@/lib/git/github";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { generatePrContent } from "@/lib/git/ai";
import { execGit } from "@/lib/git/exec";
import {
  buildMenuItems,
  resolveQuickAction,
  buildGitActionProgressStages,
  summarizeGitResult,
  requiresDefaultBranchConfirmation,
  isDefaultBranchName,
  type GitActionMenuItem,
  type GitQuickAction,
} from "@/lib/git/actions-logic";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import { CommitDialog } from "./CommitDialog";
import { SwitchBranchDialog } from "./SwitchBranchDialog";
import { MergeDialog } from "./MergeDialog";
import { DefaultBranchDialog } from "./DefaultBranchDialog";

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionHeader({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50">
        {children}
      </span>
      <span className="h-px flex-1 bg-border/30" />
      {count !== undefined && count > 0 && (
        <span className="text-[10px] tabular-nums text-muted-foreground/40">{count}</span>
      )}
    </div>
  );
}

function StatusCard({
  title,
  badgeLabel,
  badgeVariant,
  loading,
}: {
  title: string;
  badgeLabel: string;
  badgeVariant: "default" | "secondary" | "destructive" | "outline";
  loading?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border bg-card/50 px-3 py-2.5">
      {loading ? (
        <Spinner className="mt-0.5 size-3.5" />
      ) : (
        <Badge variant={badgeVariant} className="shrink-0">{badgeLabel}</Badge>
      )}
      <p className="line-clamp-2 text-[13px] leading-snug">{title}</p>
    </div>
  );
}

function QuickActionIcon({ quickAction }: { quickAction: GitQuickAction }) {
  if (quickAction.kind === "open_pr") return <HugeiconsIcon icon={LinkSquare01Icon} className="size-3.5" />;
  if (quickAction.kind === "run_pull") return <HugeiconsIcon icon={ArrowDown01Icon} className="size-3.5" />;
  if (quickAction.kind === "run_action") {
    if (quickAction.action === "commit") return <HugeiconsIcon icon={GitCommitIcon} className="size-3.5" />;
    if (quickAction.action === "commit_push") return <HugeiconsIcon icon={Upload04Icon} className="size-3.5" />;
    return <HugeiconsIcon icon={GitPullRequestIcon} className="size-3.5" />;
  }
  return <HugeiconsIcon icon={InformationCircleIcon} className="size-3.5" />;
}

function ActionIcon({ icon }: { icon: "commit" | "push" | "pr" }) {
  if (icon === "commit") return <HugeiconsIcon icon={GitCommitIcon} className="size-3.5" />;
  if (icon === "push") return <HugeiconsIcon icon={Upload04Icon} className="size-3.5" />;
  return <HugeiconsIcon icon={GitPullRequestIcon} className="size-3.5" />;
}

function PrStackCard({
  pr,
  isCurrent,
  hasConnector,
  onOpen,
  mergeActions,
}: {
  pr: PullRequestSummary;
  isCurrent: boolean;
  hasConnector: boolean;
  onOpen: () => void;
  mergeActions?: React.ReactNode;
}) {
  return (
    <div className="relative flex items-stretch gap-3">
      <div className="flex w-4 shrink-0 flex-col items-center">
        <span
          className={cn(
            "mt-1.5 size-2 shrink-0 rounded-full ring-2 ring-background",
            pr.state === "open" ? "bg-emerald-500" : pr.state === "merged" ? "bg-purple-500" : "bg-muted-foreground/40",
          )}
        />
        {hasConnector && <span className="mt-1 w-px flex-1 bg-border/30" />}
      </div>
      <div className={cn("min-w-0 flex-1", hasConnector ? "pb-4" : "pb-0")}>
        <div className="flex items-center gap-1.5">
          <HugeiconsIcon
            icon={GitPullRequestIcon}
            className={cn(
              "size-3 shrink-0",
              pr.state === "open" ? "text-emerald-500" : pr.state === "merged" ? "text-purple-400" : "text-muted-foreground/40",
            )}
          />
          <span className="text-[11px] font-medium tabular-nums text-muted-foreground/60">
            #{pr.number}
          </span>
          {isCurrent && <Badge variant="default" className="text-[10px]">Current</Badge>}
          {pr.state === "merged" && (
            <Badge variant="secondary" className="text-purple-400 text-[10px]">
              <HugeiconsIcon icon={GitMergeIcon} className="size-2.5" />
              Merged
            </Badge>
          )}
          {pr.state !== "merged" && (
            <button
              type="button"
              className="ml-auto flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] text-muted-foreground/50 hover:bg-accent hover:text-foreground"
              onClick={onOpen}
            >
              Open
            </button>
          )}
        </div>
        <p className={cn("mt-1 line-clamp-2 text-[12px] font-medium leading-snug", pr.state === "merged" && "text-muted-foreground/60")}>
          {pr.title}
        </p>
        <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground/40">
          <span className="truncate font-mono">{pr.headBranch}</span>
          <span>&rarr;</span>
          <span className="truncate font-mono">{pr.baseBranch}</span>
        </div>
        {mergeActions && <div className="mt-2">{mergeActions}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main GitPanel
// ---------------------------------------------------------------------------

export function GitPanel() {
  const repoCwd = useAppStore((s) => s.repoCwd);
  const queryClient = useQueryClient();

  const { data: gitStatus = null, isLoading: isStatusLoading } = useQuery(
    gitStatusQueryOptions(repoCwd),
  );
  const { data: branches = [] } = useQuery(gitBranchesQueryOptions(repoCwd));
  const hasOriginRemote = branches.some((b) => b.name === "origin/HEAD" || b.name.startsWith("origin/"));

  // State
  const [isCommitDialogOpen, setIsCommitDialogOpen] = useState(false);
  const [isSwitchDialogOpen, setIsSwitchDialogOpen] = useState(false);
  const [mergeDialogScope, setMergeDialogScope] = useState<"current" | "stack" | null>(null);
  const [pendingDefaultAction, setPendingDefaultAction] = useState<{
    action: StackedAction;
    branchName: string;
    includesCommit: boolean;
    commitMessage?: string;
    filePaths?: string[];
  } | null>(null);
  const [progressTitle, setProgressTitle] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: "info" | "error" | "success"; message: string } | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const isDefaultBranch = useMemo(
    () => isDefaultBranchName(gitStatus?.branch ?? null, branches),
    [gitStatus?.branch, branches],
  );

  const menuItems = useMemo(
    () => buildMenuItems(gitStatus, isBusy, isDefaultBranch, hasOriginRemote),
    [gitStatus, isBusy, isDefaultBranch, hasOriginRemote],
  );
  const quickAction = useMemo(
    () => resolveQuickAction(gitStatus, isBusy, isDefaultBranch, hasOriginRemote),
    [gitStatus, isBusy, isDefaultBranch, hasOriginRemote],
  );

  const prStack = useMemo(
    () => (gitStatus?.prStack ?? (gitStatus?.pr ? [gitStatus.pr] : [])).filter((pr) => pr.state === "open"),
    [gitStatus?.pr, gitStatus?.prStack],
  );
  const displayPrStack = useMemo(() => [...prStack].reverse(), [prStack]);

  const branchBadges = useMemo(() => {
    if (!gitStatus) return [];
    const badges: Array<{ label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = [];
    badges.push({
      label: gitStatus.hasWorkingTreeChanges ? `${gitStatus.workingTree.files.length} changed` : "Clean",
      variant: gitStatus.hasWorkingTreeChanges ? "secondary" : "default",
    });
    if (gitStatus.aheadCount > 0) badges.push({ label: `Ahead ${gitStatus.aheadCount}`, variant: "outline" });
    if (gitStatus.behindCount > 0) badges.push({ label: `Behind ${gitStatus.behindCount}`, variant: "secondary" });
    return badges;
  }, [gitStatus]);

  // Actions
  const runAction = useCallback(
    async (input: {
      action: StackedAction;
      commitMessage?: string;
      featureBranch?: boolean;
      skipDefaultBranchPrompt?: boolean;
      filePaths?: string[];
    }) => {
      if (!repoCwd || !gitStatus) return;

      // Default branch confirmation
      if (
        !input.skipDefaultBranchPrompt &&
        !input.featureBranch &&
        requiresDefaultBranchConfirmation(input.action, isDefaultBranch) &&
        gitStatus.branch
      ) {
        setPendingDefaultAction({
          action: input.action,
          branchName: gitStatus.branch,
          includesCommit: input.action === "commit" || gitStatus.hasWorkingTreeChanges,
          commitMessage: input.commitMessage,
          filePaths: input.filePaths,
        });
        return;
      }

      const stages = buildGitActionProgressStages({
        action: input.action,
        hasCustomCommitMessage: !!input.commitMessage?.trim(),
        hasWorkingTreeChanges: gitStatus.hasWorkingTreeChanges,
        featureBranch: input.featureBranch,
      });

      setIsBusy(true);
      setNotice(null);
      setProgressTitle(stages[0] ?? "Running...");

      let stageIndex = 0;
      const interval = setInterval(() => {
        stageIndex = Math.min(stageIndex + 1, stages.length - 1);
        setProgressTitle(stages[stageIndex] ?? "Running...");
      }, 1100);

      try {
        const result = await runStackedAction({
          cwd: repoCwd,
          action: input.action,
          commitMessage: input.commitMessage,
          featureBranch: input.featureBranch,
          filePaths: input.filePaths,
        });
        clearInterval(interval);
        setProgressTitle(null);

        const summary = summarizeGitResult(result);
        if (summary.noChanges) {
          setNotice({ type: "error", message: summary.description ?? summary.title });
        } else {
          setNotice({
            type: "success",
            message: summary.description ? `${summary.title} · ${summary.description}` : summary.title,
          });
        }
      } catch (err) {
        clearInterval(interval);
        setProgressTitle(null);
        setNotice({
          type: "error",
          message: err instanceof Error ? err.message : "Action failed.",
        });
      } finally {
        setIsBusy(false);
        void invalidateGitQueries(queryClient);
      }
    },
    [repoCwd, gitStatus, isDefaultBranch, queryClient],
  );

  const runQuickAction = useCallback(() => {
    if (quickAction.kind === "open_pr") {
      const url = gitStatus?.pr?.url;
      if (url) void window.electronAPI?.shell.openExternal(url);
      return;
    }
    if (quickAction.kind === "run_pull") {
      if (!repoCwd) return;
      setIsBusy(true);
      setNotice(null);
      setProgressTitle("Pulling latest changes...");
      pull(repoCwd)
        .then(() => setNotice({ type: "success", message: "Pulled from upstream." }))
        .catch((err) => setNotice({ type: "error", message: err instanceof Error ? err.message : "Pull failed." }))
        .finally(() => {
          setIsBusy(false);
          setProgressTitle(null);
          void invalidateGitQueries(queryClient);
        });
      return;
    }
    if (quickAction.kind === "show_hint") {
      setNotice({ type: "info", message: quickAction.hint ?? quickAction.label });
      return;
    }
    if (quickAction.action) {
      void runAction({ action: quickAction.action });
    }
  }, [quickAction, gitStatus?.pr?.url, repoCwd, queryClient, runAction]);

  const handleMenuItem = useCallback(
    (item: GitActionMenuItem) => {
      if (item.disabled) return;
      if (item.kind === "open_pr") {
        const url = gitStatus?.pr?.url;
        if (url) void window.electronAPI?.shell.openExternal(url);
        return;
      }
      if (item.dialogAction === "push") {
        void runAction({ action: "commit_push" });
        return;
      }
      if (item.dialogAction === "create_pr") {
        void runAction({ action: "commit_push_pr" });
        return;
      }
      setIsCommitDialogOpen(true);
    },
    [gitStatus?.pr?.url, runAction],
  );

  const handleCheckout = useCallback(
    async (branch: string) => {
      if (!repoCwd) return;
      setIsBusy(true);
      setNotice(null);
      try {
        await checkoutBranch(repoCwd, branch);
        setNotice({ type: "success", message: `Switched to ${branch}` });
        setIsSwitchDialogOpen(false);
      } catch (err) {
        setNotice({ type: "error", message: err instanceof Error ? err.message : "Checkout failed." });
      } finally {
        setIsBusy(false);
        void invalidateGitQueries(queryClient);
      }
    },
    [repoCwd, queryClient],
  );

  const [pendingDeleteBranch, setPendingDeleteBranch] = useState<string | null>(null);

  const doDeleteBranch = useCallback(
    async (branch: string) => {
      if (!repoCwd) return;
      try {
        await deleteBranch(repoCwd, branch, true);
        toast.success(`Deleted ${branch}`);
        void invalidateGitQueries(queryClient);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Delete failed.");
      }
    },
    [repoCwd, queryClient],
  );

  const handleMerge = useCallback(async () => {
    if (!repoCwd || !mergeDialogScope) return;
    setMergeDialogScope(null);
    setIsBusy(true);
    setNotice(null);
    setProgressTitle(mergeDialogScope === "stack" ? "Merging stack..." : "Merging PR...");
    try {
      const ref = gitStatus?.pr?.number?.toString();
      if (!ref) throw new Error("No PR to merge");
      await mergePullRequest(repoCwd, ref, "squash", true);
      setNotice({ type: "success", message: `Merged PR #${ref}` });
    } catch (err) {
      setNotice({ type: "error", message: err instanceof Error ? err.message : "Merge failed." });
    } finally {
      setIsBusy(false);
      setProgressTitle(null);
      void invalidateGitQueries(queryClient);
    }
  }, [repoCwd, mergeDialogScope, gitStatus?.pr?.number, queryClient]);

  const isPreReleaseBranch = gitStatus?.branch === "pre-release";
  const hasExistingReleasePr = prStack.some(
    (pr) => pr.headBranch === "pre-release" && (pr.baseBranch === "main" || pr.baseBranch === "master"),
  );

  const handleCreateReleasePr = useCallback(async () => {
    if (!repoCwd) return;
    setIsBusy(true);
    setNotice(null);
    setProgressTitle("Creating release PR...");
    try {
      // Determine target branch
      const mainExists = branches.some((b) => b.name === "main" || b.name === "origin/main");
      const targetBranch = mainExists ? "main" : "master";

      // Get range context for AI
      const [commitResult, diffStatResult, diffPatchResult] = await Promise.all([
        execGit(repoCwd, ["log", `${targetBranch}..HEAD`, "--oneline", "--no-merges"]),
        execGit(repoCwd, ["diff", `${targetBranch}...HEAD`, "--stat"]),
        execGit(repoCwd, ["diff", `${targetBranch}...HEAD`]),
      ]);

      let prTitle = "Release: pre-release → " + targetBranch;
      let prBody = "";

      try {
        const generated = await generatePrContent({
          cwd: repoCwd,
          baseBranch: targetBranch,
          headBranch: "pre-release",
          commitSummary: commitResult.stdout.slice(0, 20_000),
          diffSummary: diffStatResult.stdout.slice(0, 20_000),
          diffPatch: diffPatchResult.stdout.slice(0, 60_000),
        });
        prTitle = generated.title;
        prBody = generated.body;
      } catch {
        // Use fallback title
      }

      const pr = await createPullRequest(repoCwd, targetBranch, prTitle, prBody);
      setNotice({ type: "success", message: `Created release PR #${pr.number}` });
      void window.electronAPI?.shell.openExternal(pr.url);
    } catch (err) {
      setNotice({ type: "error", message: err instanceof Error ? err.message : "Failed to create release PR." });
    } finally {
      setIsBusy(false);
      setProgressTitle(null);
      void invalidateGitQueries(queryClient);
    }
  }, [repoCwd, branches, queryClient]);

  // Clear stale progress
  useEffect(() => {
    if (!isBusy) setProgressTitle(null);
  }, [isBusy]);

  if (!repoCwd) return null;

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-5 p-6">
          {/* Notices */}
          {progressTitle && (
            <StatusCard title={progressTitle} badgeLabel="in progress" badgeVariant="default" loading />
          )}
          {notice && !progressTitle && (
            <StatusCard
              title={notice.message}
              badgeLabel={notice.type}
              badgeVariant={
                notice.type === "success" ? "default" : notice.type === "error" ? "destructive" : "secondary"
              }
            />
          )}
          {!notice && !progressTitle && quickAction.kind === "show_hint" && quickAction.hint && (
            <StatusCard title={quickAction.hint} badgeLabel="info" badgeVariant="secondary" />
          )}

          {/* Actions row */}
          <div className="grid grid-cols-4 gap-3">
            {/* Primary action — spans full width or half */}
            {quickAction.kind !== "show_hint" && (
              <Button
                variant={quickAction.disabled ? "outline" : "default"}
                disabled={isBusy || quickAction.disabled}
                onClick={runQuickAction}
                className="col-span-4 h-auto justify-center gap-2 py-3"
              >
                <QuickActionIcon quickAction={quickAction} />
                {quickAction.label}
              </Button>
            )}
            {menuItems.map((item) => (
              <Button
                key={item.id}
                variant="outline"
                disabled={isBusy || item.disabled}
                onClick={() => handleMenuItem(item)}
                className="h-auto flex-col gap-1 py-3"
              >
                <ActionIcon icon={item.icon} />
                <span className="text-[11px]">{item.label}</span>
              </Button>
            ))}
            <Button
              variant="outline"
              onClick={() => {
                if (!gitStatus?.hasWorkingTreeChanges) {
                  setNotice({ type: "info", message: "Make local changes first to create a feature branch." });
                  return;
                }
                void runAction({ action: "commit_push", featureBranch: true, skipDefaultBranchPrompt: true });
              }}
              disabled={isBusy || !gitStatus?.hasWorkingTreeChanges}
              className="h-auto flex-col gap-1 py-3"
            >
              <HugeiconsIcon icon={GitBranchIcon} className="size-3.5" />
              <span className="text-[11px]">New branch</span>
            </Button>
          </div>

          {/* Release PR — only on pre-release branch */}
          {isPreReleaseBranch && !hasExistingReleasePr && !gitStatus?.hasWorkingTreeChanges && (
            <Button
              variant="outline"
              disabled={isBusy}
              onClick={handleCreateReleasePr}
              className="w-full justify-center gap-2 border-purple-500/30 py-3 text-purple-400 hover:bg-purple-500/10 hover:text-purple-300"
            >
              <HugeiconsIcon icon={GitPullRequestIcon} className="size-3.5" />
              Create Release PR → main
            </Button>
          )}

          {/* Pull Requests */}
          <div className="flex flex-col gap-3">
            <SectionHeader count={displayPrStack.length}>Pull Requests</SectionHeader>
            {displayPrStack.length === 0 ? (
              <div className="flex items-center gap-2 rounded-xl border border-dashed py-6 justify-center text-muted-foreground/40">
                <HugeiconsIcon icon={GitPullRequestIcon} className="size-4" />
                <span className="text-xs">No pull requests yet</span>
              </div>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <div className="divide-y">
                    {displayPrStack.map((pr) => {
                      const isCurrent = pr.number === gitStatus?.pr?.number;
                      return (
                        <button
                          key={pr.number}
                          type="button"
                          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/30"
                          onClick={() => void window.electronAPI?.shell.openExternal(pr.url)}
                        >
                          <HugeiconsIcon
                            icon={pr.state === "merged" ? GitMergeIcon : GitPullRequestIcon}
                            className={cn(
                              "size-4 shrink-0",
                              pr.state === "open" ? "text-emerald-500" : pr.state === "merged" ? "text-purple-400" : "text-muted-foreground/40",
                            )}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-muted-foreground">#{pr.number}</span>
                              <span className="truncate text-sm font-medium">{pr.title}</span>
                            </div>
                            <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground/50">
                              <span className="font-mono">{pr.headBranch}</span>
                              <span>&rarr;</span>
                              <span className="font-mono">{pr.baseBranch}</span>
                            </div>
                          </div>
                          {isCurrent && <Badge variant="default" className="shrink-0 text-[10px]">Current</Badge>}
                          {pr.state === "merged" && (
                            <Badge variant="secondary" className="shrink-0 text-[10px] text-purple-400">Merged</Badge>
                          )}
                          {pr.state === "open" && !isCurrent && (
                            <Badge variant="default" className="shrink-0 text-[10px]">Open</Badge>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Merge actions for current PR */}
            {gitStatus?.pr?.state === "open" && (
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isBusy}
                  onClick={() => setMergeDialogScope("current")}
                  className="gap-1.5"
                >
                  <HugeiconsIcon icon={GitMergeIcon} className="size-3" />
                  Merge PR
                </Button>
                {prStack.length > 1 && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isBusy}
                    onClick={() => setMergeDialogScope("stack")}
                    className="gap-1.5"
                  >
                    <HugeiconsIcon icon={GitMergeIcon} className="size-3" />
                    Merge stack
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Branches */}
          <div className="flex flex-col gap-3">
            <SectionHeader>Branches</SectionHeader>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsSwitchDialogOpen(true)}
              disabled={isBusy}
              className="w-fit gap-1.5"
            >
              <HugeiconsIcon icon={GitBranchIcon} className="size-3" />
              Switch branch
            </Button>
          </div>
        </div>
      </ScrollArea>

      {/* Dialogs */}
      <CommitDialog
        open={isCommitDialogOpen}
        onOpenChange={setIsCommitDialogOpen}
        branch={gitStatus?.branch ?? null}
        isDefaultBranch={isDefaultBranch}
        files={gitStatus?.workingTree.files ?? []}
        isBusy={isBusy}
        onCommit={(msg, paths) => {
          setIsCommitDialogOpen(false);
          void runAction({ action: "commit", commitMessage: msg || undefined, filePaths: paths });
        }}
        onCommitToNewBranch={(msg, paths) => {
          setIsCommitDialogOpen(false);
          void runAction({
            action: "commit",
            commitMessage: msg || undefined,
            featureBranch: true,
            skipDefaultBranchPrompt: true,
            filePaths: paths,
          });
        }}
      />

      <SwitchBranchDialog
        open={isSwitchDialogOpen}
        onOpenChange={setIsSwitchDialogOpen}
        branches={branches}
        isBusy={isBusy}
        onCheckout={handleCheckout}
        onDelete={(branch) => setPendingDeleteBranch(branch)}
      />

      {mergeDialogScope && (
        <MergeDialog
          open
          onOpenChange={() => setMergeDialogScope(null)}
          scope={mergeDialogScope}
          isBusy={isBusy}
          onConfirm={handleMerge}
        />
      )}

      {pendingDefaultAction && (
        <DefaultBranchDialog
          open
          onOpenChange={() => setPendingDefaultAction(null)}
          branchName={pendingDefaultAction.branchName}
          includesCommit={pendingDefaultAction.includesCommit}
          onContinueOnDefault={() => {
            const action = pendingDefaultAction;
            setPendingDefaultAction(null);
            void runAction({
              action: action.action,
              commitMessage: action.commitMessage,
              skipDefaultBranchPrompt: true,
              filePaths: action.filePaths,
            });
          }}
          onCreateFeatureBranch={() => {
            const action = pendingDefaultAction;
            setPendingDefaultAction(null);
            void runAction({
              action: action.action,
              commitMessage: action.commitMessage,
              featureBranch: true,
              skipDefaultBranchPrompt: true,
              filePaths: action.filePaths,
            });
          }}
        />
      )}

      <ConfirmDialog
        open={pendingDeleteBranch !== null}
        onOpenChange={(open) => { if (!open) setPendingDeleteBranch(null); }}
        title="Delete branch"
        description={`Delete branch "${pendingDeleteBranch}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          if (pendingDeleteBranch) void doDeleteBranch(pendingDeleteBranch);
          setPendingDeleteBranch(null);
        }}
      />
    </div>
  );
}
