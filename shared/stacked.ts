export type StackedAction = "commit" | "commit_push" | "commit_push_pr";

export interface StackedActionInput {
  cwd: string;
  action: StackedAction;
  commitMessage?: string;
  featureBranch?: boolean;
  filePaths?: string[];
}

export interface StackedActionResult {
  action: StackedAction;
  branch: { status: "created" | "skipped_not_requested"; name?: string };
  commit: { status: "created" | "skipped_no_changes"; commitSha?: string; subject?: string };
  push: {
    status: "pushed" | "skipped_not_requested" | "skipped_up_to_date";
    branch?: string;
    setUpstream?: boolean;
  };
  pr: {
    status: "created" | "opened_existing" | "skipped_not_requested";
    url?: string;
    number?: number;
    baseBranch?: string;
    headBranch?: string;
    title?: string;
  };
}
