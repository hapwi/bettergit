import { execGh, readOriginRepoSlug, requireOk } from "./git-exec";
import type { PullRequestSummary, PrListItem } from "../shared/github";

export async function listOpenPullRequests(input: {
  cwd: string;
  headBranch?: string;
}): Promise<PullRequestSummary[]> {
  const { cwd } = input;
  const repo = await readOriginRepoSlug(cwd);
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
  if (repo) args.push("--repo", repo);
  if (input.headBranch) args.push("--head", input.headBranch);

  const result = await execGh({ cwd, args });
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

export async function getPullRequest(input: {
  cwd: string;
  reference: string;
}): Promise<PullRequestSummary | null> {
  const result = await execGh({
    cwd: input.cwd,
    args: ["pr", "view", input.reference, "--json", "number,title,url,baseRefName,headRefName,state"],
  });
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

export async function createPullRequest(input: {
  cwd: string;
  baseBranch: string;
  title: string;
  body: string;
}): Promise<PullRequestSummary> {
  const stdout = requireOk(
    await execGh({
      cwd: input.cwd,
      args: ["pr", "create", "--base", input.baseBranch, "--title", input.title, "--body", input.body],
    }),
    "create PR",
  );

  const url = stdout.trim();
  const viewResult = await execGh({
    cwd: input.cwd,
    args: ["pr", "view", url, "--json", "number,title,url,baseRefName,headRefName,state"],
  });

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

  const numberMatch = url.match(/\/pull\/(\d+)/);
  return {
    number: numberMatch ? parseInt(numberMatch[1], 10) : 0,
    title: input.title,
    url,
    baseBranch: input.baseBranch,
    headBranch: "",
    state: "open",
  };
}

export async function mergePullRequest(input: {
  cwd: string;
  reference: string;
  method?: "merge" | "squash" | "rebase";
  deleteBranch?: boolean;
}): Promise<{ ok: true }> {
  const method = input.method ?? "squash";
  const deleteBranch = input.deleteBranch ?? true;
  const args = ["pr", "merge", input.reference, `--${method}`];
  if (deleteBranch) args.push("--delete-branch");
  requireOk(await execGh({ cwd: input.cwd, args }), `merge PR ${input.reference}`);
  return { ok: true };
}

export async function listPrs(
  cwd: string,
  state: "open" | "merged",
  limit: number,
  baseBranch?: string,
): Promise<PrListItem[]> {
  const repo = await readOriginRepoSlug(cwd);
  const args = [
    "pr", "list", "--state", state, "--limit", String(limit),
    "--json", "number,title,url,baseRefName,headRefName,headRefOid,state,author,updatedAt",
  ];
  if (baseBranch) args.push("--base", baseBranch);
  if (repo) args.push("--repo", repo);
  const ghResult = await execGh({ cwd, args });
  if (ghResult.code !== 0) return [];
  try {
    const raw = JSON.parse(ghResult.stdout) as Array<{
      number: number;
      title: string;
      url: string;
      baseRefName: string;
      headRefName: string;
      headRefOid?: string;
      state: string;
      author: { login: string };
      updatedAt: string;
    }>;
    return raw.map((pr) => ({
      number: pr.number,
      title: pr.title,
      url: pr.url,
      baseBranch: pr.baseRefName,
      headBranch: pr.headRefName,
      headSha: pr.headRefOid ?? "",
      state,
      author: pr.author?.login ?? "",
      updatedAt: pr.updatedAt ?? "",
    }));
  } catch {
    return [];
  }
}
