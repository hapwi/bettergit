import { FolderOpenIcon, Folder01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAppStore } from "@/store";

export function WelcomeScreen() {
  const setRepoCwd = useAppStore((s) => s.setRepoCwd);
  const recentRepos = useAppStore((s) => s.recentRepos);

  const handleOpenRepo = async () => {
    const path = await window.electronAPI?.dialog.openDirectory();
    if (path) setRepoCwd(path);
  };

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">BetterGit</CardTitle>
          <CardDescription>
            A simple, focused git manager for your repositories.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Button size="lg" onClick={handleOpenRepo} className="w-full">
            <HugeiconsIcon icon={FolderOpenIcon} data-icon="inline-start" />
            Open Repository
          </Button>

          {recentRepos.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-muted-foreground">Recent</p>
              {recentRepos.map((repo) => (
                <button
                  key={repo}
                  type="button"
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
