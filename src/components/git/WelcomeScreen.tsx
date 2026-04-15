import { useState } from "react";
import { FolderOpenIcon, Folder01Icon, ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppStore } from "@/store";
import { GitHubIcon } from "@/components/icons";
import { GitHubReposDialog } from "./GitHubReposDialog";
import { toast } from "sonner";

export function WelcomeScreen() {
  const setRepoCwd = useAppStore((s) => s.setRepoCwd);
  const recentProjects = useAppStore((s) => s.recentProjects);
  const githubFolder = useAppStore((s) => s.githubFolder);
  const [ghDialogOpen, setGhDialogOpen] = useState(false);

  const handleOpenExisting = async () => {
    const path = await window.electronAPI?.dialog.openDirectory();
    if (path) setRepoCwd(path);
  };

  const handleAddFromGithub = () => {
    if (!githubFolder) {
      toast.error("Set a GitHub destination folder in Settings before adding from GitHub.");
      return;
    }
    setGhDialogOpen(true);
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-background px-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-8">
        {/* Logo / branding */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className="size-8 text-primary"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <circle cx="12" cy="4" r="1.5" fill="currentColor" />
              <circle cx="12" cy="20" r="1.5" fill="currentColor" />
              <path d="M12 7v2M12 15v2" />
              <path d="M8.5 8.5 12 12" />
              <circle cx="6" cy="6" r="1.5" fill="currentColor" />
            </svg>
          </div>
          <div className="flex flex-col items-center gap-1">
            <h1 className="text-2xl font-bold tracking-tight">BetterGit</h1>
            <p className="text-sm text-muted-foreground">
              A simple, focused git manager.
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex w-full flex-col gap-3">
          <div className="flex w-full gap-0">
            <Button
              size="lg"
              onClick={handleOpenExisting}
              className="flex-1 rounded-r-none"
            >
              <HugeiconsIcon icon={FolderOpenIcon} data-icon="inline-start" />
              Open Repository
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="lg"
                  className="rounded-l-none border-l border-primary-foreground/20 px-2.5"
                >
                  <HugeiconsIcon icon={ArrowDown01Icon} className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={handleOpenExisting}>
                  <HugeiconsIcon icon={FolderOpenIcon} className="size-4" />
                  Add Existing
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleAddFromGithub}>
                  <GitHubIcon className="size-4" />
                  Add from GitHub
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Recent repos */}
        {recentProjects.length > 0 && (
          <div className="flex w-full flex-col gap-1.5">
            <p className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Recent
            </p>
            <div className="flex flex-col gap-0.5 rounded-lg border bg-card p-1">
              {recentProjects.map((project) => (
                <button
                  key={project.path}
                  type="button"
                  className="flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
                  onClick={() => setRepoCwd(project.path)}
                >
                  <HugeiconsIcon
                    icon={Folder01Icon}
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {project.path.split("/").pop()}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {project.path}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <GitHubReposDialog open={ghDialogOpen} onOpenChange={setGhDialogOpen} />
    </div>
  );
}
