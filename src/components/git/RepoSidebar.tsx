import { useState, useEffect } from "react";
import { execGit } from "@/lib/git/exec";
import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";
import {
  GitBranchIcon,
  Add01Icon,
  ArrowUp01Icon,
  ArrowDown01Icon,
  ExchangeIcon,
  Settings01Icon,
  PinIcon,
  PinOffIcon,
  PencilEdit01Icon,
  Delete01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { SettingsDialog } from "@/components/git/SettingsDialog";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

const isDevBuild = import.meta.env.DEV;

function ProjectFavicon({ cwd, fallback }: { cwd: string; fallback: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import("@/lib/server").then(({ serverFetch }) =>
      serverFetch<{ favicon: string | null }>("/api/project/favicon", { cwd }).then((res) => {
        if (!cancelled) setSrc(res.favicon);
      }),
    ).catch(() => {
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
  isPinned,
  isActive,
  onSelect,
  onRename,
  onTogglePin,
  onRemove,
  gitBusy,
  gitResult,
}: {
  path: string;
  isPinned: boolean;
  isActive: boolean;
  onSelect: () => void;
  onRename: () => void;
  onTogglePin: () => void;
  onRemove: () => void;
  gitBusy: boolean;
  gitResult: "success" | "error" | null;
}) {
  const name = path.split("/").pop() ?? "Repository";
  const showStatus = gitBusy || gitResult !== null;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: path });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: "relative" as const,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div ref={setNodeRef} style={style}>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={isActive}
              onClick={onSelect}
              className="group/item cursor-grab active:cursor-grabbing"
              {...attributes}
              {...listeners}
            >
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
              ) : null}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onRename}>
          <HugeiconsIcon icon={PencilEdit01Icon} className="size-4" />
          Rename
        </ContextMenuItem>
        <ContextMenuItem onSelect={onTogglePin}>
          <HugeiconsIcon icon={isPinned ? PinOffIcon : PinIcon} className="size-4" />
          {isPinned ? "Unpin" : "Pin"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={onRemove}>
          <HugeiconsIcon icon={Delete01Icon} className="size-4" />
          Remove
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function RepoSidebar() {
  const repoCwd = useAppStore((s) => s.repoCwd);
  const recentProjects = useAppStore((s) => s.recentProjects);
  const setRepoCwd = useAppStore((s) => s.setRepoCwd);
  const removeRecentRepo = useAppStore((s) => s.removeRecentRepo);
  const renameRecentRepo = useAppStore((s) => s.renameRecentRepo);
  const reorderRepos = useAppStore((s) => s.reorderRepos);
  const togglePinnedRepo = useAppStore((s) => s.togglePinnedRepo);
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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    reorderRepos(active.id as string, over.id as string);
  };

  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingRenameRepo, setPendingRenameRepo] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [pendingRemoveRepo, setPendingRemoveRepo] = useState<string | null>(null);

  const doRenameMasterToMain = async () => {
    if (!repoCwd) return;

    try {
      await execGit(repoCwd, ["branch", "-m", "master", "main"]);
      await execGit(repoCwd, ["push", "-u", "origin", "main"]);
      await execGit(repoCwd, ["remote", "set-head", "origin", "main"]);
      await execGit(repoCwd, ["push", "origin", "--delete", "master"]);
      toast.success("Renamed master to main (local + remote)");
      void invalidateGitQueries(queryClient);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rename failed");
    }
  };

  const openRenameProjectDialog = (path: string) => {
    setPendingRenameRepo(path);
    setRenameValue(path.split("/").pop() ?? "");
  };

  const closeRenameProjectDialog = () => {
    setPendingRenameRepo(null);
    setRenameValue("");
  };

  const doRenameProjectDirectory = async () => {
    if (!pendingRenameRepo) return;

    const nextName = renameValue.trim();
    if (!nextName) {
      toast.error("Project name cannot be empty");
      return;
    }

    try {
      const nextPath = await window.electronAPI?.project.renameDirectory(pendingRenameRepo, nextName);
      if (!nextPath) {
        throw new Error("Rename service unavailable");
      }
      renameRecentRepo(pendingRenameRepo, nextPath);
      toast.success(`Renamed project to ${nextName}`);
      closeRenameProjectDialog();
      void invalidateGitQueries(queryClient);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to rename project");
    }
  };

  const renameProjectName = pendingRenameRepo?.split("/").pop() ?? "";
  const renameProjectDisabled = renameValue.trim().length === 0 || renameValue.trim() === renameProjectName;

  return (
    <Sidebar className="bg-sidebar">
      <SidebarHeader className="pt-11">
        {isDevBuild && (
          <div className="mx-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-center text-xs font-medium tracking-wide text-amber-500">
            Dev Build
          </div>
        )}
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
                        if (!repoCwd) return;
                        try {
                          await execGit(repoCwd, ["checkout", "-b", "pre-release"]);
                          const remoteCheck = await execGit(repoCwd, ["remote"]);
                          const hasOrigin = remoteCheck.stdout.split("\n").some((r: string) => r.trim() === "origin");
                          if (hasOrigin) {
                            await execGit(repoCwd, ["push", "-u", "origin", "pre-release"]);
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

        {/* Pinned */}
        {recentProjects.some((p) => p.pinned) && (
          <SidebarGroup>
            <SidebarGroupLabel className="flex items-center gap-1.5">
              <HugeiconsIcon icon={PinIcon} className="size-3" />
              Pinned
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext items={recentProjects.filter((p) => p.pinned).map((p) => p.path)} strategy={verticalListSortingStrategy}>
                  <SidebarMenu>
                    {recentProjects.filter((p) => p.pinned).map((project) => (
                      <ProjectItem
                        key={project.path}
                        path={project.path}
                        isPinned={project.pinned}
                        isActive={project.path === repoCwd}
                        onSelect={() => setRepoCwd(project.path)}
                        onRename={() => openRenameProjectDialog(project.path)}
                        onTogglePin={() => togglePinnedRepo(project.path)}
                        onRemove={() => setPendingRemoveRepo(project.path)}
                        gitBusy={gitBusyMap[project.path] ?? false}
                        gitResult={gitResultMap[project.path] ?? null}
                      />
                    ))}
                  </SidebarMenu>
                </SortableContext>
              </DndContext>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Projects */}
        <SidebarGroup>
          <SidebarGroupLabel>Projects</SidebarGroupLabel>
          <SidebarGroupContent>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={recentProjects.filter((p) => !p.pinned).map((p) => p.path)} strategy={verticalListSortingStrategy}>
                <SidebarMenu>
                  {recentProjects.filter((p) => !p.pinned).map((project) => (
                    <ProjectItem
                      key={project.path}
                      path={project.path}
                      isPinned={project.pinned}
                      isActive={project.path === repoCwd}
                      onSelect={() => setRepoCwd(project.path)}
                      onRename={() => openRenameProjectDialog(project.path)}
                      onTogglePin={() => togglePinnedRepo(project.path)}
                      onRemove={() => setPendingRemoveRepo(project.path)}
                      gitBusy={gitBusyMap[project.path] ?? false}
                      gitResult={gitResultMap[project.path] ?? null}
                    />
                  ))}
                  {recentProjects.length === 0 && (
                    <p className="px-2 py-3 text-center text-xs text-muted-foreground/50">
                      No projects yet
                    </p>
                  )}
                </SidebarMenu>
              </SortableContext>
            </DndContext>
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

      <Dialog
        open={pendingRenameRepo !== null}
        onOpenChange={(open) => {
          if (!open) closeRenameProjectDialog();
        }}
      >
        <DialogContent showCloseButton={false}>
          <form
            className="flex flex-col gap-6"
            onSubmit={(event) => {
              event.preventDefault();
              if (!renameProjectDisabled) {
                void doRenameProjectDirectory();
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>Rename project</DialogTitle>
              <DialogDescription>
                Change the folder name on disk for this project. BetterGit will update the saved path automatically.
              </DialogDescription>
            </DialogHeader>
            <Input
              autoFocus
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              placeholder="Project name"
            />
            <DialogFooter>
              <Button variant="outline" type="button" onClick={closeRenameProjectDialog}>
                Cancel
              </Button>
              <Button type="submit" disabled={renameProjectDisabled}>
                Rename
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingRemoveRepo !== null}
        onOpenChange={(open) => { if (!open) setPendingRemoveRepo(null); }}
        title="Remove from BetterGit"
        description={`Remove "${pendingRemoveRepo?.split("/").pop()}" from BetterGit? This only removes it from the app and won't delete any files.`}
        confirmLabel="Remove"
        onConfirm={() => {
          if (pendingRemoveRepo) removeRecentRepo(pendingRemoveRepo);
          setPendingRemoveRepo(null);
        }}
      />
    </Sidebar>
  );
}
