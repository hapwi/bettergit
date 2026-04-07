/**
 * GitHub CLI operations — PR management via `gh`.
 */
import { execGh, requireSuccess } from "./exec";
import { getOriginRepoSlug } from "./remote";

export interface PullRequestSummary {
  number: number;
  title: string;
  url: string;
  baseBranch: string;
  headBranch: string;
  state: "open" | "closed" | "merged";
}

export async function listOpenPullRequests(
  cwd: string,
  headBranch: string,
): Promise<PullRequestSummary[]> {
  // Resolve the origin remote to scope PR queries to the user's repo (not upstream for forks)
  const repo = await getOriginRepoSlug(cwd);

  const args = [
    "pr",
    "list",
    "--state",
    "open",
    "--json",
    "number,title,url,baseRefName,headRefName,state",
    "--limit",
    "20",
  ];
  if (repo) {
    args.push("--repo", repo);
  }
  if (headBranch) {
    args.push("--head", headBranch);
  }
  const result = await execGh(cwd, args);
  if (result.code !== 0) return [];

  try {
    const raw = JSON.parse(result.stdout) as Array<{
      number: number;
      title: string;
      url: string;
      baseRefName: string;
      headRefName: string;
      state: string;
    }>;
    return raw.map((pr) => ({
      number: pr.number,
      title: pr.title,
      url: pr.url,
      baseBranch: pr.baseRefName,
      headBranch: pr.headRefName,
      state: pr.state === "MERGED" ? "merged" : pr.state === "CLOSED" ? "closed" : "open",
    }));
  } catch {
    return [];
  }
}

export async function getPullRequest(
  cwd: string,
  reference: string,
): Promise<PullRequestSummary | null> {
  const result = await execGh(cwd, [
    "pr",
    "view",
    reference,
    "--json",
    "number,title,url,baseRefName,headRefName,state",
  ]);
  if (result.code !== 0) return null;

  try {
    const pr = JSON.parse(result.stdout) as {
      number: number;
      title: string;
      url: string;
      baseRefName: string;
      headRefName: string;
      state: string;
    };
    return {
      number: pr.number,
      title: pr.title,
      url: pr.url,
      baseBranch: pr.baseRefName,
      headBranch: pr.headRefName,
      state: pr.state === "MERGED" ? "merged" : pr.state === "CLOSED" ? "closed" : "open",
    };
  } catch {
    return null;
  }
}

export async function createPullRequest(
  cwd: string,
  baseBranch: string,
  title: string,
  body: string,
): Promise<PullRequestSummary> {
  // Create the PR (returns the PR URL on stdout)
  const stdout = requireSuccess(
    await execGh(cwd, [
      "pr",
      "create",
      "--base",
      baseBranch,
      "--title",
      title,
      "--body",
      body,
    ]),
    "create PR",
  );

  const url = stdout.trim();

  // Fetch the created PR details
  const viewResult = await execGh(cwd, [
    "pr",
    "view",
    url,
    "--json",
    "number,title,url,baseRefName,headRefName,state",
  ]);

  if (viewResult.code === 0) {
    const pr = JSON.parse(viewResult.stdout) as {
      number: number;
      title: string;
      url: string;
      baseRefName: string;
      headRefName: string;
      state: string;
    };
    return {
      number: pr.number,
      title: pr.title,
      url: pr.url,
      baseBranch: pr.baseRefName,
      headBranch: pr.headRefName,
      state: "open",
    };
  }

  // Fallback if view fails — parse number from URL
  const numberMatch = url.match(/\/pull\/(\d+)/);
  return {
    number: numberMatch ? parseInt(numberMatch[1], 10) : 0,
    title,
    url,
    baseBranch,
    headBranch: "",
    state: "open",
  };
}

export async function mergePullRequest(
  cwd: string,
  reference: string,
  method: "merge" | "squash" | "rebase" = "squash",
  deleteBranch = true,
): Promise<void> {
  const args = ["pr", "merge", reference, `--${method}`];
  if (deleteBranch) args.push("--delete-branch");
  requireSuccess(await execGh(cwd, args), `merge PR ${reference}`);
}

export async function createGhRepo(
  cwd: string,
  visibility: "public" | "private" = "private",
): Promise<void> {
  requireSuccess(
    await execGh(cwd, [
      "repo",
      "create",
      "--source",
      ".",
      `--${visibility}`,
      "--push",
    ]),
    "create GitHub repo",
  );
}

export async function getGhDefaultBranch(cwd: string): Promise<string | null> {
  const result = await execGh(cwd, [
    "repo",
    "view",
    "--json",
    "defaultBranchRef",
  ]);
  if (result.code !== 0) return null;
  try {
    const data = JSON.parse(result.stdout) as { defaultBranchRef?: { name?: string } };
    return data.defaultBranchRef?.name ?? null;
  } catch {
    return null;
  }
}
