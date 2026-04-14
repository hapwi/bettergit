import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { GitBranchIcon, ExchangeIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { gitBranchesQueryOptions, gitStatusQueryOptions, invalidateGitQueries } from "@/lib/git/queries";
import { execGit } from "@/lib/git/exec";
import { toast } from "sonner";

export function ProjectSettingsDialog({
  open,
  onOpenChange,
  projectPath,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectPath: string;
}) {
  const queryClient = useQueryClient();
  const { data: branches = [] } = useQuery(gitBranchesQueryOptions(projectPath));
  const { data: status } = useQuery(gitStatusQueryOptions(projectPath));

  const hasOriginRemote = status?.hasOriginRemote ?? false;
  const hasPreRelease = branches.some(
    (b) => b.name === "pre-release" || b.name === "origin/pre-release",
  );
  const hasMasterNotMain = branches.some((b) => b.name === "master") &&
    !branches.some((b) => b.name === "main");
  const showPreReleaseSetting = Boolean(
    status?.hasCommits && !status.isDetached && hasOriginRemote && !hasPreRelease,
  );
  const showMasterRenameSetting = Boolean(
    hasMasterNotMain && status?.hasCommits && hasOriginRemote,
  );

  const projectName = projectPath.split("/").pop() ?? "Project";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{projectName}</DialogTitle>
          <DialogDescription>Project settings</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50">Branch Setup</p>

          {showPreReleaseSetting && (
            <div className="flex items-center gap-3 rounded-xl border bg-card/50 px-3 py-2.5">
              <HugeiconsIcon icon={GitBranchIcon} className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Pre-release branch</p>
                <p className="text-[11px] text-muted-foreground">Not set up yet</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 text-xs"
                onClick={() => {
                  void (async () => {
                    try {
                      await execGit(projectPath, ["checkout", "-b", "pre-release"]);
                      if (hasOriginRemote) {
                        await execGit(projectPath, ["push", "-u", "origin", "pre-release"]);
                      }
                      toast.success("Created pre-release branch");
                      void invalidateGitQueries(queryClient);
                    } catch {
                      toast.error("Failed to create pre-release branch");
                    }
                  })();
                }}
              >
                Create
              </Button>
            </div>
          )}

          {showMasterRenameSetting && (
            <div className="flex items-center gap-3 rounded-xl border bg-card/50 px-3 py-2.5">
              <HugeiconsIcon icon={ExchangeIcon} className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Rename master → main</p>
                <p className="text-[11px] text-muted-foreground">Default branch is master</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 text-xs"
                onClick={() => {
                  void (async () => {
                    try {
                      await execGit(projectPath, ["branch", "-m", "master", "main"]);
                      await execGit(projectPath, ["push", "-u", "origin", "main"]);
                      await execGit(projectPath, ["remote", "set-head", "origin", "main"]);
                      await execGit(projectPath, ["push", "origin", "--delete", "master"]);
                      toast.success("Renamed master to main (local + remote)");
                      void invalidateGitQueries(queryClient);
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Rename failed");
                    }
                  })();
                }}
              >
                Rename
              </Button>
            </div>
          )}

          {!showPreReleaseSetting && !showMasterRenameSetting && (
            <p className="py-3 text-center text-xs text-muted-foreground/50">
              No branch setup actions needed
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
