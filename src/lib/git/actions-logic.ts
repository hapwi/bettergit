/**
 * Git action resolution logic — ported from hapcode's GitActionsControl.logic.ts.
 * Determines which buttons to show and what the primary action should be.
 */
import type { GitStatus } from "./status";
import type { StackedAction, StackedActionResult } from "./stacked";

export type GitActionIconName = "commit" | "push" | "pr";

export interface GitActionMenuItem {
  id: "commit" | "push" | "pr";
  label: string;
  disabled: boolean;
  highlighted?: boolean;
  icon: GitActionIconName;
  kind: "open_dialog" | "open_pr";
  dialogAction?: "commit" | "push" | "create_pr";
}

export interface GitQuickAction {
  label: string;
  disabled: boolean;
  kind: "run_action" | "run_pull" | "open_pr" | "show_hint";
  action?: StackedAction;
  hint?: string;
}

function isProtectedBranch(name: string): boolean {
  return name === "main" || name === "master" || name === "pre-release";
}

export function buildMenuItems(
  gitStatus: GitStatus | null,
  isBusy: boolean,
  isDefaultBranch: boolean,
  hasOriginRemote: boolean,
): GitActionMenuItem[] {
  if (!gitStatus) return [];

  const hasBranch = gitStatus.branch !== null;
  const hasChanges = gitStatus.hasWorkingTreeChanges;
  const hasOpenPr = gitStatus.pr?.state === "open";
  const isBehind = gitStatus.behindCount > 0;
  const canCommit = !isBusy && hasChanges;
  const canPush =
    !isBusy &&
    hasOriginRemote &&
    hasBranch &&
    !hasChanges &&
    !isBehind &&
    gitStatus.aheadCount > 0;
  const canCreatePr =
    !isBusy &&
    hasOriginRemote &&
    hasBranch &&
    !hasChanges &&
    !hasOpenPr &&
    !isDefaultBranch;
  const canOpenPr = !isBusy && !!hasOpenPr;

  return [
    {
      id: "commit",
      label: "Commit",
      disabled: !canCommit,
      icon: "commit",
      kind: "open_dialog",
      dialogAction: "commit",
    },
    {
      id: "push",
      label: "Push",
      disabled: !canPush,
      icon: "push",
      kind: "open_dialog",
      dialogAction: "push",
    },
    hasOpenPr
      ? { id: "pr", label: "View PR", disabled: !canOpenPr, icon: "pr", kind: "open_pr" as const }
      : {
          id: "pr" as const,
          label: "Create PR",
          disabled: !canCreatePr,
          highlighted: canCreatePr,
          icon: "pr" as const,
          kind: "open_dialog" as const,
          dialogAction: "create_pr" as const,
        },
  ];
}

export function resolveQuickAction(
  gitStatus: GitStatus | null,
  isBusy: boolean,
  isDefaultBranch: boolean,
  hasOriginRemote: boolean,
): GitQuickAction {
  if (isBusy) {
    return { label: "Commit", disabled: true, kind: "show_hint", hint: "Git action in progress." };
  }
  if (!gitStatus) {
    return { label: "Commit", disabled: true, kind: "show_hint", hint: "Git status is unavailable." };
  }

  const hasBranch = gitStatus.branch !== null;
  const hasChanges = gitStatus.hasWorkingTreeChanges;
  const hasOpenPr = gitStatus.pr?.state === "open";
  const isAhead = gitStatus.aheadCount > 0;
  const isBehind = gitStatus.behindCount > 0;
  const isDiverged = isAhead && isBehind;

  if (!hasBranch) {
    return { label: "Commit", disabled: true, kind: "show_hint", hint: "Create and checkout a branch first." };
  }

  if (hasChanges) {
    // No remote yet — this is an initial publish, push the current branch directly
    if (!hasOriginRemote) {
      return {
        label: "Commit & publish",
        disabled: false,
        kind: "run_action",
        action: "commit_push",
      };
    }
    if (isDefaultBranch) {
      return {
        label: "Commit to new branch",
        disabled: false,
        kind: "run_action",
        action: "commit_push",
      };
    }
    if (hasOpenPr) {
      return {
        label: "Commit & update PR",
        disabled: false,
        kind: "run_action",
        action: "commit_push",
      };
    }
    return {
      label: "Commit & push",
      disabled: false,
      kind: "run_action",
      action: "commit_push",
    };
  }

  if (!gitStatus.hasUpstream && !hasOriginRemote) {
    if (hasOpenPr && !isAhead) return { label: "View PR", disabled: false, kind: "open_pr" };
    return { label: "Publish to GitHub", disabled: false, kind: "run_action", action: "commit_push" };
  }

  if (isDiverged) {
    return { label: "Sync branch", disabled: true, kind: "show_hint", hint: "Branch has diverged. Rebase/merge first." };
  }

  if (isBehind) {
    return { label: "Pull", disabled: false, kind: "run_pull" };
  }

  if (isAhead) {
    return {
      label: hasOpenPr ? "Push to PR" : "Push",
      disabled: false,
      kind: "run_action",
      action: "commit_push",
    };
  }

  if (hasOpenPr) {
    return { label: "View PR", disabled: false, kind: "open_pr" };
  }

  return { label: "Commit", disabled: true, kind: "show_hint", hint: "Branch is up to date. No action needed." };
}

export function buildGitActionProgressStages(input: {
  action: StackedAction;
  hasCustomCommitMessage: boolean;
  hasWorkingTreeChanges: boolean;
  forcePushOnly?: boolean;
  featureBranch?: boolean;
}): string[] {
  const branchStages = input.featureBranch ? ["Preparing feature branch..."] : [];
  const shouldIncludeCommitStages =
    !input.forcePushOnly && (input.action === "commit" || input.hasWorkingTreeChanges);
  const commitStages = !shouldIncludeCommitStages
    ? []
    : input.hasCustomCommitMessage
      ? ["Committing..."]
      : ["Generating commit message...", "Committing..."];

  if (input.action === "commit") return [...branchStages, ...commitStages];
  if (input.action === "commit_push") return [...branchStages, ...commitStages, "Pushing..."];
  return [...branchStages, ...commitStages, "Pushing...", "Creating PR..."];
}

export function summarizeGitResult(result: StackedActionResult): {
  title: string;
  description?: string;
  noChanges?: boolean;
} {
  if (result.pr.status === "created" || result.pr.status === "opened_existing") {
    const prNumber = result.pr.number ? ` #${result.pr.number}` : "";
    const title = `${result.pr.status === "created" ? "Created PR" : "Opened PR"}${prNumber}`;
    return { title, description: result.pr.title };
  }

  if (result.push.status === "pushed") {
    const shortSha = result.commit.commitSha?.slice(0, 7);
    const branch = result.push.branch;
    return {
      title: `Pushed${shortSha ? ` ${shortSha}` : ""}${branch ? ` to ${branch}` : ""}`,
      description: result.commit.subject,
    };
  }

  if (result.commit.status === "created") {
    const shortSha = result.commit.commitSha?.slice(0, 7);
    return {
      title: shortSha ? `Committed ${shortSha}` : "Committed changes",
      description: result.commit.subject,
    };
  }

  if (result.commit.status === "skipped_no_changes") {
    return {
      title: "No changes to commit",
      description: "There are no uncommitted changes.",
      noChanges: true,
    };
  }

  return { title: "Done" };
}

export function requiresDefaultBranchConfirmation(
  action: StackedAction,
  isDefaultBranch: boolean,
): boolean {
  if (!isDefaultBranch) return false;
  return action === "commit_push" || action === "commit_push_pr";
}

export function isDefaultBranchName(branchName: string | null, branches: Array<{ name: string; isDefault: boolean }>): boolean {
  if (!branchName) return false;
  if (isProtectedBranch(branchName)) return true;
  const found = branches.find((b) => b.name === branchName);
  return found?.isDefault ?? false;
}
