import { useEffect, useState } from "react";
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

interface MergeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: "current" | "stack";
  baseBranch: string;
  repoCwd: string;
  isBusy: boolean;
  onConfirm: (versionBump: BumpType | null) => void;
}

function parseVersion(tag: string): { major: number; minor: number; patch: number } | null {
  const match = tag.replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return { major: parseInt(match[1], 10), minor: parseInt(match[2], 10), patch: parseInt(match[3], 10) };
}

function bumpVersion(v: { major: number; minor: number; patch: number }, type: BumpType) {
  switch (type) {
    case "major": return { major: v.major + 1, minor: 0, patch: 0 };
    case "minor": return { major: v.major, minor: v.minor + 1, patch: 0 };
    case "patch": return { major: v.major, minor: v.minor, patch: v.patch + 1 };
  }
}

function formatVersion(v: { major: number; minor: number; patch: number }) {
  return `v${v.major}.${v.minor}.${v.patch}`;
}

const BUMP_OPTIONS: { type: BumpType; label: string; desc: string }[] = [
  { type: "patch", label: "Patch", desc: "Bug fixes" },
  { type: "minor", label: "Minor", desc: "New features" },
  { type: "major", label: "Major", desc: "Breaking changes" },
];

export function MergeDialog({ open, onOpenChange, scope, baseBranch, repoCwd, isBusy, onConfirm }: MergeDialogProps) {
  const isMainMerge = baseBranch === "main" || baseBranch === "master";
  const [currentVersion, setCurrentVersion] = useState<{ major: number; minor: number; patch: number } | null>(null);
  const [selectedBump, setSelectedBump] = useState<BumpType | null>(null);
  const [versionLoading, setVersionLoading] = useState(false);

  useEffect(() => {
    if (!open || !isMainMerge) return;
    setSelectedBump(null);
    setVersionLoading(true);
    (async () => {
      try {
        await execGit(repoCwd, ["fetch", "--tags", "--quiet", "origin"]).catch(() => {});
        const result = await execGit(repoCwd, ["tag", "--sort=-v:refname", "-l", "v*"]);
        const tags = result.stdout.trim().split("\n").filter(Boolean);
        for (const tag of tags) {
          const parsed = parseVersion(tag);
          if (parsed) { setCurrentVersion(parsed); return; }
        }
        // No tags found — try reading version from package.json
        const pkgResult = await execGit(repoCwd, ["show", "HEAD:package.json"]);
        if (pkgResult.code === 0) {
          try {
            const pkg = JSON.parse(pkgResult.stdout) as { version?: string };
            if (pkg.version) {
              const parsed = parseVersion(pkg.version);
              if (parsed) { setCurrentVersion(parsed); return; }
            }
          } catch { /* invalid JSON */ }
        }
        setCurrentVersion({ major: 0, minor: 0, patch: 0 });
      } catch {
        setCurrentVersion({ major: 0, minor: 0, patch: 0 });
      } finally {
        setVersionLoading(false);
      }
    })();
  }, [open, isMainMerge, repoCwd]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {scope === "stack" ? "Merge stack" : "Merge pull request"}
          </DialogTitle>
          <DialogDescription>
            {scope === "stack"
              ? "Squash merge all PRs in the stack from base to tip."
              : "Squash merge the current open pull request."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-2.5 rounded-lg border bg-card/30 p-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Merged branches will be deleted automatically. Protected branches (main, master,
            pre-release) are kept.
          </p>
        </div>

        {/* Version release picker — only for merges into main/master */}
        {isMainMerge && (
          <div className="flex flex-col gap-2">
            {versionLoading || !currentVersion ? (
              <div className="flex items-center gap-2 py-2">
                <Spinner className="size-3.5" />
                <p className="text-xs text-muted-foreground">Loading version info…</p>
              </div>
            ) : (
              <>
                <p className="text-xs font-medium text-muted-foreground">
                  Version release{" "}
                  <span className="font-normal">
                    (current: {formatVersion(currentVersion)})
                  </span>
                </p>
                <div className="grid grid-cols-3 gap-1.5">
                  {BUMP_OPTIONS.map((opt) => {
                    const preview = bumpVersion(currentVersion, opt.type);
                    const isSelected = selectedBump === opt.type;
                    return (
                      <button
                        key={opt.type}
                        type="button"
                        onClick={() => setSelectedBump(isSelected ? null : opt.type)}
                        className={cn(
                          "flex flex-col items-center gap-0.5 rounded-lg border px-2 py-2 transition-colors",
                          isSelected
                            ? "border-primary bg-primary/10"
                            : "border-border hover:bg-accent",
                        )}
                      >
                        <span className="text-xs font-medium">{opt.label}</span>
                        <span className={cn(
                          "font-mono text-[11px]",
                          isSelected ? "text-primary" : "text-muted-foreground",
                        )}>
                          {formatVersion(preview)}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {!selectedBump && (
                  <p className="text-[11px] text-muted-foreground/60">
                    Select a bump type to tag a release, or merge without a version tag.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => onConfirm(selectedBump)} disabled={isBusy}>
            {isBusy && <Spinner data-icon="inline-start" />}
            {selectedBump && currentVersion
              ? `Merge & tag ${formatVersion(bumpVersion(currentVersion, selectedBump))}`
              : scope === "stack" ? "Merge stack" : "Merge PR"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
