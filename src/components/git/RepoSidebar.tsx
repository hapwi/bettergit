import { useState, useEffect } from "react";
import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";
import {
  GitBranchIcon,
  Cancel01Icon,
  Add01Icon,
  ArrowUp01Icon,
  ArrowDown01Icon,
  ExchangeIcon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useAppStore } from "@/store";
import { gitStatusQueryOptions, gitBranchesQueryOptions, invalidateGitQueries } from "@/lib/git/queries";
import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SettingsDialog } from "@/components/git/SettingsDialog";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

function ProjectFavicon({ cwd, fallback }: { cwd: string; fallback: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI?.project.favicon(cwd).then((dataUrl) => {
      if (!cancelled) setSrc(dataUrl);
    }).catch(() => {
      if (!cancelled) setError(true);
    });
    return () => { cancelled = true; };
  }, [cwd]);

  if (!src || error) {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-[10px] font-bold uppercase text-muted-foreground">
        {fallback}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt=""
      className="size-6 shrink-0 rounded-md object-contain"
      onError={() => setError(true)}
    />
  );
}

function ProjectItem({
  path,
  isActive,
  onSelect,
  onRemove,
  gitBusy,
  gitResult,
}: {
  path: string;
  isActive: boolean;
  onSelect: () => void;
  onRemove: () => void;
  gitBusy: boolean;
  gitResult: "success" | "error" | null;
}) {
  const name = path.split("/").pop() ?? "Repository";
  const showStatus = gitBusy || gitResult !== null;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={isActive} onClick={onSelect} className="group/item">
        <ProjectFavicon cwd={path} fallback={name.slice(0, 2)} />
        <span className="flex-1 truncate text-sm">{name}</span>
        {showStatus ? (
          <span className="shrink-0">
            {gitBusy && <Spinner className="size-3.5" />}
            {!gitBusy && gitResult === "success" && (
              <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-3.5 text-emerald-500" />
            )}
            {!gitBusy && gitResult === "error" && (
              <span className="flex size-3.5 items-center justify-center">
                <span className="size-1.5 rounded-full bg-red-500" />
              </span>
            )}
          </span>
        ) : (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.stopPropagation(); onRemove(); }
            }}
            className="shrink-0 text-muted-foreground/30 opacity-0 transition-opacity hover:text-destructive group-hover/item:opacity-100"
          >
            <HugeiconsIcon icon={Cancel01Icon} className="size-3" />
          </span>
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function RepoSidebar() {
  const repoCwd = useAppStore((s) => s.repoCwd);
  const recentRepos = useAppStore((s) => s.recentRepos);
  const setRepoCwd = useAppStore((s) => s.setRepoCwd);
  const removeRecentRepo = useAppStore((s) => s.removeRecentRepo);
  const gitBusyMap = useAppStore((s) => s.gitBusyMap);
  const gitResultMap = useAppStore((s) => s.gitResultMap);
  const queryClient = useQueryClient();
  const { data: status } = useQuery(gitStatusQueryOptions(repoCwd));
  const { data: branches = [] } = useQuery(gitBranchesQueryOptions(repoCwd));

  const changeCount = status?.workingTree.files.length ?? 0;
  const hasPreRelease = branches.some(
    (b) => b.name === "pre-release" || b.name === "origin/pre-release",
  );
  const hasMasterNotMain = branches.some((b) => b.name === "master") &&
    !branches.some((b) => b.name === "main");

  const handleOpen = async () => {
    const path = await window.electronAPI?.dialog.openDirectory();
    if (path) setRepoCwd(path);
  };

  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingRemoveRepo, setPendingRemoveRepo] = useState<string | null>(null);

  const doRenameMasterToMain = async () => {
    if (!repoCwd || !window.electronAPI) return;

    try {
      // Rename local branch
      await window.electronAPI.git.exec({ cwd: repoCwd, args: ["branch", "-m", "master", "main"] });
      // Push new branch name
      await window.electronAPI.git.exec({ cwd: repoCwd, args: ["push", "-u", "origin", "main"] });
      // Set remote HEAD
      await window.electronAPI.git.exec({ cwd: repoCwd, args: ["remote", "set-head", "origin", "main"] });
      // Delete old remote branch
      await window.electronAPI.git.exec({ cwd: repoCwd, args: ["push", "origin", "--delete", "master"] });
      toast.success("Renamed master to main (local + remote)");
      void invalidateGitQueries(queryClient);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rename failed");
    }
  };

  return (
    <Sidebar className="bg-sidebar">
      <SidebarHeader className="pt-11" />

      <SidebarContent>
        {/* Active project status */}
        {status && repoCwd && (
          <SidebarGroup>
            <SidebarGroupLabel>
              {repoCwd.split("/").pop()}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <div className="flex flex-col gap-1.5 px-2">
                {/* Branch */}
                <div className="flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs">
                  <HugeiconsIcon icon={GitBranchIcon} className="size-3 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium">{status.branch ?? "detached"}</span>
                </div>

                {/* Quick stats */}
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="flex items-center gap-1.5 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs">
                    <span className={cn(
                      "size-1.5 rounded-full",
                      changeCount > 0 ? "bg-amber-500" : "bg-emerald-500",
                    )} />
                    <span className="text-muted-foreground">
                      {changeCount > 0 ? `${changeCount} changed` : "Clean"}
                    </span>
                  </div>
                  {status.pr ? (
                    <div className="flex items-center gap-1.5 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs">
                      <span className="size-1.5 rounded-full bg-emerald-500" />
                      <span className="text-muted-foreground">PR #{status.pr.number}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs">
                      <span className="size-1.5 rounded-full bg-muted-foreground/30" />
                      <span className="text-muted-foreground/50">No PR</span>
                    </div>
                  )}
                </div>

                {/* Sync */}
                {status.hasUpstream && (status.aheadCount > 0 || status.behindCount > 0) && (
                  <div className="flex items-center gap-3 px-1 text-[11px] text-muted-foreground">
                    {status.aheadCount > 0 && (
                      <span className="flex items-center gap-0.5">
                        <HugeiconsIcon icon={ArrowUp01Icon} className="size-3 text-emerald-500" />
                        {status.aheadCount}
                      </span>
                    )}
                    {status.behindCount > 0 && (
                      <span className="flex items-center gap-0.5">
                        <HugeiconsIcon icon={ArrowDown01Icon} className="size-3 text-amber-500" />
                        {status.behindCount}
                      </span>
                    )}
                  </div>
                )}

                {/* Pre-release branch detection */}
                {!hasPreRelease && (
                  <div className="mt-1 rounded-md border border-dashed border-amber-500/30 bg-amber-500/5 px-2.5 py-2">
                    <p className="text-[11px] text-amber-500/80">
                      No pre-release branch detected.
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-1 h-6 w-full justify-center text-[11px] text-amber-500 hover:text-amber-400"
                      onClick={async () => {
                        if (!repoCwd || !window.electronAPI) return;
                        try {
                          await window.electronAPI.git.exec({
                            cwd: repoCwd,
                            args: ["checkout", "-b", "pre-release"],
                          });
                          // Push to remote if origin exists
                          const remoteCheck = await window.electronAPI.git.exec({
                            cwd: repoCwd,
                            args: ["remote"],
                          });
                          const hasOrigin = remoteCheck.stdout.split("\n").some((r: string) => r.trim() === "origin");
                          if (hasOrigin) {
                            await window.electronAPI.git.exec({
                              cwd: repoCwd,
                              args: ["push", "-u", "origin", "pre-release"],
                            });
                          }
                          toast.success("Created pre-release branch");
                          void invalidateGitQueries(queryClient);
                        } catch {
                          toast.error("Failed to create pre-release branch");
                        }
                      }}
                    >
                      Set up pre-release branch
                    </Button>
                  </div>
                )}

                {/* Rename master → main */}
                {hasMasterNotMain && (
                  <div className="mt-1 rounded-md border border-dashed border-blue-500/30 bg-blue-500/5 px-2.5 py-2">
                    <p className="text-[11px] text-blue-400/80">
                      Default branch is "master".
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-1 h-6 w-full justify-center text-[11px] text-blue-400 hover:text-blue-300"
                      onClick={() => setRenameDialogOpen(true)}
                    >
                      <HugeiconsIcon icon={ExchangeIcon} className="size-3" />
                      Rename to main
                    </Button>
                  </div>
                )}
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Projects */}
        <SidebarGroup>
          <SidebarGroupLabel>Projects</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {recentRepos.map((repo) => (
                <ProjectItem
                  key={repo}
                  path={repo}
                  isActive={repo === repoCwd}
                  onSelect={() => setRepoCwd(repo)}
                  onRemove={() => setPendingRemoveRepo(repo)}
                  gitBusy={gitBusyMap[repo] ?? false}
                  gitResult={gitResultMap[repo] ?? null}
                />
              ))}
              {recentRepos.length === 0 && (
                <p className="px-2 py-3 text-center text-xs text-muted-foreground/50">
                  No projects yet
                </p>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-2">
        <div className="flex gap-1.5">
          <Button
            variant="outline"
            className="flex-1 justify-center gap-2"
            onClick={handleOpen}
          >
            <HugeiconsIcon icon={Add01Icon} />
            Open Project
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setSettingsOpen(true)}
            className="shrink-0"
          >
            <HugeiconsIcon icon={Settings01Icon} className="size-4" />
          </Button>
        </div>
      </SidebarFooter>

      <ConfirmDialog
        open={renameDialogOpen}
        onOpenChange={setRenameDialogOpen}
        title="Rename branch"
        description="Rename 'master' to 'main' locally and on remote? This will update the default branch."
        confirmLabel="Rename"
        onConfirm={() => void doRenameMasterToMain()}
      />

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

      <ConfirmDialog
        open={pendingRemoveRepo !== null}
        onOpenChange={(open) => { if (!open) setPendingRemoveRepo(null); }}
        title="Remove project"
        description={`Remove "${pendingRemoveRepo?.split("/").pop()}" from the sidebar? This won't delete any files.`}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={() => {
          if (pendingRemoveRepo) removeRecentRepo(pendingRemoveRepo);
          setPendingRemoveRepo(null);
        }}
      />
    </Sidebar>
  );
}
