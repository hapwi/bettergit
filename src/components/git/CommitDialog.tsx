import { useState } from "react";
import { GitBranchIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { WorkingTreeFile } from "@/lib/git/status";

interface CommitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branch: string | null;
  isDefaultBranch: boolean;
  files: WorkingTreeFile[];
  isBusy: boolean;
  onCommit: (commitMessage: string, filePaths?: string[]) => void;
  onCommitToNewBranch: (commitMessage: string, filePaths?: string[]) => void;
}

export function CommitDialog({
  open,
  onOpenChange,
  branch,
  isDefaultBranch,
  files,
  isBusy,
  onCommit,
  onCommitToNewBranch,
}: CommitDialogProps) {
  const [commitMessage, setCommitMessage] = useState("");
  const [excludedFiles, setExcludedFiles] = useState<Set<string>>(new Set());
  const [isEditingFiles, setIsEditingFiles] = useState(false);

  const selectedFiles = files.filter((f) => !excludedFiles.has(f.path));
  const allSelected = excludedFiles.size === 0;
  const noneSelected = selectedFiles.length === 0;

  const handleCommit = () => {
    const msg = commitMessage.trim();
    const paths = !allSelected ? selectedFiles.map((f) => f.path) : undefined;
    onCommit(msg, paths);
    setCommitMessage("");
    setExcludedFiles(new Set());
    setIsEditingFiles(false);
  };

  const handleCommitToNewBranch = () => {
    const msg = commitMessage.trim();
    const paths = !allSelected ? selectedFiles.map((f) => f.path) : undefined;
    onCommitToNewBranch(msg, paths);
    setCommitMessage("");
    setExcludedFiles(new Set());
    setIsEditingFiles(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setCommitMessage("");
          setExcludedFiles(new Set());
          setIsEditingFiles(false);
        }
        onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Commit changes</DialogTitle>
          <DialogDescription>
            Review and confirm your commit. Leave the message blank to auto-generate one.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Branch info */}
          <div className="flex items-center gap-2 rounded-lg border bg-card/30 px-3 py-2 text-xs">
            <HugeiconsIcon icon={GitBranchIcon} className="size-3 text-muted-foreground" />
            <span className="font-medium">{branch ?? "(detached HEAD)"}</span>
            {isDefaultBranch && (
              <Badge variant="secondary" className="ml-auto">Default branch</Badge>
            )}
          </div>

          {/* File list */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs">
                {isEditingFiles && files.length > 0 && (
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={() => {
                      setExcludedFiles(
                        allSelected ? new Set(files.map((f) => f.path)) : new Set(),
                      );
                    }}
                  />
                )}
                <span className="font-medium">
                  Files
                  {!allSelected && !isEditingFiles && (
                    <span className="text-muted-foreground font-normal">
                      {" "}({selectedFiles.length} of {files.length})
                    </span>
                  )}
                </span>
              </div>
              {files.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setIsEditingFiles((p) => !p)}>
                  {isEditingFiles ? "Done" : "Edit"}
                </Button>
              )}
            </div>
            {files.length === 0 ? (
              <div className="flex items-center justify-center rounded-lg border border-dashed py-4 text-xs text-muted-foreground">
                No changed files
              </div>
            ) : (
              <ScrollArea className="h-44 rounded-lg border bg-card/30">
                <div className="flex flex-col gap-0.5 p-1">
                  {files.map((file) => {
                    const isExcluded = excludedFiles.has(file.path);
                    return (
                      <div
                        key={file.path}
                        className={`flex items-center gap-2 rounded-md px-2 py-1.5 font-mono text-[11px] hover:bg-accent/30 ${isExcluded ? "opacity-50" : ""}`}
                      >
                        {isEditingFiles && (
                          <Checkbox
                            checked={!isExcluded}
                            onCheckedChange={() => {
                              setExcludedFiles((prev) => {
                                const next = new Set(prev);
                                if (isExcluded) next.delete(file.path);
                                else next.add(file.path);
                                return next;
                              });
                            }}
                          />
                        )}
                        <span className="flex-1 truncate">{file.path}</span>
                        <span className="shrink-0 text-muted-foreground">
                          {file.insertions > 0 && (
                            <span className="text-emerald-500">+{file.insertions}</span>
                          )}
                          {file.deletions > 0 && (
                            <span className="ml-1 text-red-500">-{file.deletions}</span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </div>

          {/* Commit message */}
          <Textarea
            placeholder="Leave blank to auto-generate with AI..."
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            rows={3}
            className="resize-none"
          />
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          {isDefaultBranch && (
            <Button
              variant="outline"
              onClick={handleCommitToNewBranch}
              disabled={isBusy || noneSelected}
            >
              {isBusy && <Spinner data-icon="inline-start" />}
              Commit to new branch
            </Button>
          )}
          <Button
            onClick={handleCommit}
            disabled={isBusy || noneSelected}
          >
            {isBusy && <Spinner data-icon="inline-start" />}
            {commitMessage.trim() ? "Commit" : "Commit (AI message)"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
