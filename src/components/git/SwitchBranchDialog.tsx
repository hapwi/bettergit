import { useMemo, useState } from "react";
import { GitBranchIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Branch } from "@/lib/git/branches";

interface SwitchBranchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branches: Branch[];
  isBusy: boolean;
  onCheckout: (branch: string) => void;
  onDelete: (branch: string) => void;
}

export function SwitchBranchDialog({
  open,
  onOpenChange,
  branches,
  isBusy,
  onCheckout,
  onDelete,
}: SwitchBranchDialogProps) {
  const [filter, setFilter] = useState("");

  const switchable = useMemo(() => {
    const local = branches.filter((b) => !b.current && !b.isRemote);
    const remote = branches.filter(
      (b) => b.isRemote && b.name.startsWith("origin/") && b.name !== "origin/HEAD",
    );
    const localNames = new Set(local.map((b) => b.name));
    const remoteOnly = remote.filter(
      (b) => !localNames.has(b.name.slice("origin/".length)),
    );

    return [
      ...local.map((b) => ({ branch: b, remoteOnly: false })),
      ...remoteOnly.map((b) => ({ branch: b, remoteOnly: true })),
    ].sort((a, b) => a.branch.name.localeCompare(b.branch.name));
  }, [branches]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return switchable;
    return switchable.filter(({ branch }) => branch.name.toLowerCase().includes(q));
  }, [filter, switchable]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setFilter(""); onOpenChange(v); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Switch branch</DialogTitle>
          <DialogDescription>Search and switch to any local or remote branch.</DialogDescription>
        </DialogHeader>

        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search branches..."
          autoFocus
        />

        <div className="max-h-72 overflow-y-auto rounded-lg border bg-card/30">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 py-6 text-muted-foreground">
              <HugeiconsIcon icon={GitBranchIcon} className="size-4" />
              <span className="text-xs">No branches found</span>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5 p-1">
              {filtered.map(({ branch, remoteOnly }) => (
                <div
                  key={branch.name}
                  className="group flex items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-accent/40"
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => onCheckout(branch.name)}
                    disabled={isBusy}
                  >
                    <HugeiconsIcon icon={GitBranchIcon} className="size-3 shrink-0 text-muted-foreground" />
                    <span className="truncate text-xs font-medium">{branch.name}</span>
                    {remoteOnly && (
                      <Badge variant="outline" className="ml-auto shrink-0">remote</Badge>
                    )}
                  </button>
                  {!branch.isDefault && !branch.current && !["main", "master", "pre-release"].includes(branch.name) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="shrink-0 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                      disabled={isBusy}
                      onClick={() => onDelete(branch.name)}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
