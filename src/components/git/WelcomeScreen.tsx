import { FolderOpenIcon, Folder01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store";

export function WelcomeScreen() {
  const setRepoCwd = useAppStore((s) => s.setRepoCwd);
  const recentRepos = useAppStore((s) => s.recentRepos);

  const handleOpenRepo = async () => {
    const path = await window.electronAPI?.dialog.openDirectory();
    if (path) setRepoCwd(path);
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
          <Button size="lg" onClick={handleOpenRepo} className="w-full">
            <HugeiconsIcon icon={FolderOpenIcon} data-icon="inline-start" />
            Open Repository
          </Button>
        </div>

        {/* Recent repos */}
        {recentRepos.length > 0 && (
          <div className="flex w-full flex-col gap-1.5">
            <p className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Recent
            </p>
            <div className="flex flex-col gap-0.5 rounded-lg border bg-card p-1">
              {recentRepos.map((repo) => (
                <button
                  key={repo}
                  type="button"
                  className="flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
                  onClick={() => setRepoCwd(repo)}
                >
                  <HugeiconsIcon
                    icon={Folder01Icon}
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {repo.split("/").pop()}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {repo}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
