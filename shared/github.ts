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
}

export interface GhAuthStatus {
  connected: boolean;
  detail: string;
}

export interface GhRepo {
  name: string;
  nameWithOwner: string;
  description: string;
  isPrivate: boolean;
  updatedAt: string;
}
