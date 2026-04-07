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
          <DialogTitle>{actionLabel} to default branch?</DialogTitle>
          <DialogDescription>
            This will {includesCommit ? "commit and push changes" : "push local commits"} directly
            to "{branchName}". You can continue here or create a feature branch instead.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={onCreateFeatureBranch}>
            Create feature branch
          </Button>
          <Button onClick={onContinueOnDefault}>
            {actionLabel} to {branchName}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
