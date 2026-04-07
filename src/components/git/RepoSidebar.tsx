import { useQuery } from "@tanstack/react-query";
import {
  GitBranchIcon,
  Cancel01Icon,
  Add01Icon,
  ArrowUp01Icon,
  ArrowDown01Icon,
  ExchangeIcon,
  SidebarLeftIcon,
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
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

function ProjectItem({
  path,
  isActive,
  onSelect,
  onRemove,
}: {
  path: string;
  isActive: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const name = path.split("/").pop() ?? "Repository";

  return (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={isActive} onClick={onSelect} className="group/item">
        <div
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold uppercase",
            isActive
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground",
          )}
        >
          {name.slice(0, 2)}
        </div>
        <span className="flex-1 truncate text-sm">{name}</span>
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
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function RepoSidebar() {
  const repoCwd = useAppStore((s) => s.repoCwd);
  const recentRepos = useAppStore((s) => s.recentRepos);
  const setRepoCwd = useAppStore((s) => s.setRepoCwd);
  const removeRecentRepo = useAppStore((s) => s.removeRecentRepo);
  const queryClient = useQueryClient();
  const { toggleSidebar } = useSidebar();
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

  const handleRenameMasterToMain = async () => {
    if (!repoCwd || !window.electronAPI) return;
    if (!window.confirm("Rename 'master' to 'main' locally and on remote? This will update the default branch.")) return;

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
    <Sidebar className="bg-sidebar backdrop-blur-xl">
      {/* Header — clean, no toggle icon */}
      <SidebarHeader className="px-3 pb-2 pt-14">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-primary">
              <HugeiconsIcon icon={GitBranchIcon} className="size-3.5 text-primary-foreground" />
            </div>
            <span className="text-sm font-bold tracking-tight">BetterGit</span>
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={toggleSidebar}
            className="text-muted-foreground/40 hover:text-foreground"
          >
            <HugeiconsIcon icon={SidebarLeftIcon} className="size-3.5" />
          </Button>
        </div>
      </SidebarHeader>

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
                            args: ["branch", "pre-release"],
                          });
                          await window.electronAPI.git.exec({
                            cwd: repoCwd,
                            args: ["push", "-u", "origin", "pre-release"],
                          });
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
                      onClick={handleRenameMasterToMain}
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
                  onRemove={() => removeRecentRepo(repo)}
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
        <Button
          variant="outline"
          className="w-full justify-center gap-2"
          onClick={handleOpen}
        >
          <HugeiconsIcon icon={Add01Icon} />
          Open Project
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
