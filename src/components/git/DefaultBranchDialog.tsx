import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DefaultBranchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchName: string;
  includesCommit: boolean;
  onContinueOnDefault: () => void;
  onCreateFeatureBranch: () => void;
}

export function DefaultBranchDialog({
  open,
  onOpenChange,
  branchName,
  includesCommit,
  onContinueOnDefault,
  onCreateFeatureBranch,
}: DefaultBranchDialogProps) {
  const actionLabel = includesCommit ? "Commit & push" : "Push";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>You&apos;re on {branchName}</DialogTitle>
          <DialogDescription>
            Create a feature branch for your changes, or {includesCommit ? "commit and push" : "push"} directly to &ldquo;{branchName}&rdquo;.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={onContinueOnDefault}>
            {actionLabel} to {branchName}
          </Button>
          <Button onClick={onCreateFeatureBranch}>
            Create feature branch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
