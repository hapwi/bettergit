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

interface MergeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: "current" | "stack";
  isBusy: boolean;
  onConfirm: () => void;
}

export function MergeDialog({ open, onOpenChange, scope, isBusy, onConfirm }: MergeDialogProps) {
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

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={onConfirm} disabled={isBusy}>
            {isBusy && <Spinner data-icon="inline-start" />}
            {scope === "stack" ? "Merge stack" : "Merge PR"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
