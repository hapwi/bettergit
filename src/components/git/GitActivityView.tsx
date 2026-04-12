import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkCircle02Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { Spinner } from "@/components/ui/spinner";
import { GitHubIcon } from "@/components/icons";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StepStatus = "queued" | "active" | "done" | "failed";

export interface ActivityStep {
  id: string;
  label: string;
  status: StepStatus;
  detail?: string;
  url?: string;
}

export interface GitActivityState {
  title: string;
  steps: ActivityStep[];
  /** Estimated ms between step advancements. 0 = no auto-advance. */
  advanceMs: number;
  startedAt: number;
  completedAt?: number;
  completedTitle?: string;
  error?: string;
  summary?: string;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case "queued":
      return (
        <span className="flex size-3.5 items-center justify-center">
          <span className="size-2 rounded-full border-[1.5px] border-muted-foreground/20" />
        </span>
      );
    case "active":
      return <Spinner className="size-3.5 text-primary" />;
    case "done":
      return <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-3.5 text-emerald-500" />;
    case "failed":
      return <HugeiconsIcon icon={Cancel01Icon} className="size-3.5 text-destructive" />;
  }
}

// ---------------------------------------------------------------------------
// GitActivityView
// ---------------------------------------------------------------------------

interface GitActivityViewProps {
  activity: GitActivityState;
  onDismiss?: () => void;
}

export function GitActivityView({ activity, onDismiss }: GitActivityViewProps) {
  const isComplete = activity.completedAt !== undefined;
  const doneCount = activity.steps.filter((s) => s.status === "done").length;
  const failedCount = activity.steps.filter((s) => s.status === "failed").length;
  const activeStep = activity.steps.find((s) => s.status === "active");
  const title = isComplete && activity.completedTitle ? activity.completedTitle : activity.title;

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5">
          {!isComplete && (
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/40" />
              <span className="relative inline-flex size-2 rounded-full bg-primary" />
            </span>
          )}
          <span
            className={cn(
              "text-[11px] font-semibold uppercase tracking-wider",
              isComplete
                ? failedCount > 0
                  ? "text-destructive/60"
                  : "text-emerald-500/60"
                : "text-primary/60",
            )}
          >
            {title}
          </span>
        </div>
        <span className="h-px flex-1 bg-border/30" />
        {isComplete ? (
          <button
            type="button"
            onClick={onDismiss}
            className="text-[10px] text-muted-foreground/40 transition-colors hover:text-muted-foreground"
          >
            Dismiss
          </button>
        ) : activity.steps.length > 1 ? (
          <span className="text-[10px] tabular-nums text-muted-foreground/40">
            {doneCount}/{activity.steps.length}
          </span>
        ) : null}
      </div>

      {/* Steps */}
      <div className="divide-y overflow-hidden rounded-xl border">
        {activity.steps.map((step) => (
          <div
            key={step.id}
            className={cn(
              "flex w-full items-center gap-2.5 px-3 py-2 transition-all duration-500",
              step.status === "queued" && "opacity-40",
              step.status === "done" && "bg-emerald-500/[0.03]",
              step.status === "failed" && "bg-destructive/[0.03]",
            )}
          >
            <StatusIcon status={step.status} />
            <span
              className={cn(
                "truncate text-sm transition-colors duration-500",
                step.status === "queued" && "text-muted-foreground",
              )}
            >
              {step.label}
            </span>
            {step.detail && (
              <span
                className={cn(
                  "ml-auto shrink-0 text-[11px]",
                  step.status === "done" ? "text-muted-foreground/40" : "text-muted-foreground/30",
                )}
              >
                {step.detail}
              </span>
            )}
            {step.url && (
              <button
                type="button"
                className={cn(
                  "shrink-0 rounded-md p-1 transition-colors hover:bg-accent hover:text-foreground",
                  step.detail ? "" : "ml-auto",
                  "text-muted-foreground/30",
                )}
                onClick={() => void window.electronAPI?.shell.openExternal(step.url!)}
              >
                <GitHubIcon className="size-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      {isComplete ? (
        activity.summary ? (
          <p className="text-xs text-muted-foreground/40">{activity.summary}</p>
        ) : null
      ) : activeStep ? (
        <div className="flex items-center gap-2">
          <span className="size-1.5 animate-pulse rounded-full bg-primary/60" />
          <p className="text-xs text-muted-foreground/40">{activeStep.label}...</p>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="size-1.5 animate-pulse rounded-full bg-primary/60" />
          <p className="text-xs text-muted-foreground/40">Preparing...</p>
        </div>
      )}
    </div>
  );
}
