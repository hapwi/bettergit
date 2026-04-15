export interface PullRequestSummary {
  number: number;
  title: string;
  url: string;
  baseBranch: string;
  headBranch: string;
  state: "open" | "closed" | "merged";
}

export interface PrListItem {
  number: number;
  title: string;
  url: string;
  baseBranch: string;
  headBranch: string;
  headSha?: string;
  state: "open" | "closed" | "merged";
  author: string;
  updatedAt: string;
  /** First tag containing this PR's head commit (e.g. "v0.3.3") */
  tag?: string;
}

export interface GhAuthStatus {
  connected: boolean;
  detail: string;
}

export interface GhViewer {
  login: string;
  avatarUrl: string;
  url: string;
}

export interface GhRepo {
  name: string;
  nameWithOwner: string;
  description: string;
  isPrivate: boolean;
  updatedAt: string;
}
