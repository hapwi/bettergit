import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { listGhRepos, cloneGhRepo, type GhRepo } from "@/lib/git/github";
import { useAppStore } from "@/store";
import { toast } from "sonner";
import { GitHubIcon } from "@/components/icons";
import { LockedIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

export function GitHubReposDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const githubFolder = useAppStore((s) => s.githubFolder);
  const setRepoCwd = useAppStore((s) => s.setRepoCwd);
  const [repos, setRepos] = useState<GhRepo[]>([]);
  const [loading, setLoading] = useState(false);
  const [cloning, setCloning] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const fetchRepos = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listGhRepos(100);
      setRepos(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch repos");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setSearch("");
      void fetchRepos();
    }
  }, [open, fetchRepos]);

  const filtered = useMemo(() => {
    if (!search.trim()) return repos;
    const q = search.toLowerCase();
    return repos.filter(
      (r) =>
        r.nameWithOwner.toLowerCase().includes(q) ||
        (r.description && r.description.toLowerCase().includes(q)),
    );
  }, [repos, search]);


  const handleClone = async (repo: GhRepo) => {
    if (!githubFolder) {
      toast.error("Set a GitHub folder in Settings before cloning.");
      return;
    }
    setCloning(repo.nameWithOwner);
    try {
      const { clonedPath } = await cloneGhRepo(repo.nameWithOwner, githubFolder);
      toast.success(`Cloned ${repo.name}`);
      setRepoCwd(clonedPath);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Clone failed");
    } finally {
      setCloning(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add from GitHub</DialogTitle>
          <DialogDescription>Clone a repository from your GitHub account</DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-4 overflow-hidden">
          <Input
            placeholder="Search repositories…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
            className="focus-visible:ring-0 focus-visible:border-transparent"
          />

          <ScrollArea className="h-[320px] -mx-2">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner className="size-5 text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <p className="text-sm text-destructive">{error}</p>
              <button
                type="button"
                className="text-xs text-muted-foreground underline hover:text-foreground"
                onClick={() => void fetchRepos()}
              >
                Retry
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-sm text-muted-foreground">
                {search ? "No matching repos" : "No repos found"}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5 px-2">
              {filtered.map((repo) => (
                <button
                  key={repo.nameWithOwner}
                  type="button"
                  disabled={cloning !== null}
                  className="flex min-w-0 items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent disabled:opacity-50"
                  onClick={() => void handleClone(repo)}
                >
                  <GitHubIcon className="size-4 shrink-0 text-muted-foreground" />
                  <p className="min-w-0 flex-1 truncate text-sm font-medium">
                    {repo.nameWithOwner}
                  </p>
                  {repo.isPrivate && (
                    <HugeiconsIcon
                      icon={LockedIcon}
                      className="size-3 shrink-0 text-muted-foreground"
                    />
                  )}
                  {cloning === repo.nameWithOwner && (
                    <Spinner className="size-4 shrink-0 text-muted-foreground" />
                  )}
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
