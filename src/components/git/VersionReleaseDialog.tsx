import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { execGit } from "@/lib/git/exec";

type BumpType = "patch" | "minor" | "major";

interface VersionReleaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoCwd: string;
  onTagCreated: (tag: string) => void;
}

function parseVersion(tag: string): { major: number; minor: number; patch: number } | null {
  const match = tag.replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return { major: parseInt(match[1], 10), minor: parseInt(match[2], 10), patch: parseInt(match[3], 10) };
}

function bumpVersion(version: { major: number; minor: number; patch: number }, type: BumpType) {
  switch (type) {
    case "major":
      return { major: version.major + 1, minor: 0, patch: 0 };
    case "minor":
      return { major: version.major, minor: version.minor + 1, patch: 0 };
    case "patch":
      return { major: version.major, minor: version.minor, patch: version.patch + 1 };
  }
}

function formatVersion(v: { major: number; minor: number; patch: number }) {
  return `v${v.major}.${v.minor}.${v.patch}`;
}

const BUMP_OPTIONS: { type: BumpType; label: string; description: string }[] = [
  { type: "patch", label: "Patch", description: "Bug fixes, small changes" },
  { type: "minor", label: "Minor", description: "New features, backwards compatible" },
  { type: "major", label: "Major", description: "Breaking changes" },
];

export function VersionReleaseDialog({
  open,
  onOpenChange,
  repoCwd,
  onTagCreated,
}: VersionReleaseDialogProps) {
  const [currentVersion, setCurrentVersion] = useState<{ major: number; minor: number; patch: number } | null>(null);
  const [selectedBump, setSelectedBump] = useState<BumpType>("patch");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    setIsLoading(true);
    setSelectedBump("patch");
    execGit(repoCwd, ["tag", "--sort=-v:refname", "-l", "v*"])
      .then((result) => {
        const tags = result.stdout.trim().split("\n").filter(Boolean);
        for (const tag of tags) {
          const parsed = parseVersion(tag);
          if (parsed) {
            setCurrentVersion(parsed);
            return;
          }
        }
        setCurrentVersion({ major: 0, minor: 0, patch: 0 });
      })
      .catch(() => {
        setCurrentVersion({ major: 0, minor: 0, patch: 0 });
      })
      .finally(() => setIsLoading(false));
  }, [open, repoCwd]);

  const newVersion = currentVersion ? bumpVersion(currentVersion, selectedBump) : null;

  const handleCreate = useCallback(async () => {
    if (!newVersion) return;
    const tag = formatVersion(newVersion);
    setIsCreating(true);
    try {
      const tagResult = await execGit(repoCwd, ["tag", tag]);
      if (tagResult.code !== 0) throw new Error(tagResult.stderr);
      const pushResult = await execGit(repoCwd, ["push", "origin", tag]);
      if (pushResult.code !== 0) throw new Error(pushResult.stderr);
      onTagCreated(tag);
      onOpenChange(false);
    } catch {
      // If tag creation fails, still close — the merge already succeeded
      onOpenChange(false);
    } finally {
      setIsCreating(false);
    }
  }, [repoCwd, newVersion, onTagCreated, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Create version release</DialogTitle>
          <DialogDescription>
            {isLoading
              ? "Checking current version..."
              : currentVersion
                ? `Current version: ${formatVersion(currentVersion)}`
                : "No existing tags found"}
          </DialogDescription>
        </DialogHeader>

        {!isLoading && currentVersion && (
          <div className="flex flex-col gap-1.5">
            {BUMP_OPTIONS.map((opt) => {
              const preview = bumpVersion(currentVersion, opt.type);
              const isSelected = selectedBump === opt.type;
              return (
                <button
                  key={opt.type}
                  type="button"
                  onClick={() => setSelectedBump(opt.type)}
                  className={cn(
                    "flex items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-colors",
                    isSelected
                      ? "border-primary bg-primary/10"
                      : "border-border hover:bg-accent",
                  )}
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">{opt.label}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {opt.description}
                    </span>
                  </div>
                  <span
                    className={cn(
                      "font-mono text-sm",
                      isSelected ? "text-primary" : "text-muted-foreground",
                    )}
                  >
                    {formatVersion(preview)}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Skip
          </Button>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={isLoading || isCreating || !newVersion}
          >
            {isCreating && <Spinner data-icon="inline-start" />}
            {newVersion ? `Tag ${formatVersion(newVersion)}` : "Create tag"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
