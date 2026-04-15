import path from "node:path";
import { execGh, readOriginRepoSlug, requireOk } from "./git-exec";
import type { GhRepo, GhAuthStatus, GhViewer } from "../shared/github";

export async function createGhRepo(input: {
  cwd: string;
  visibility?: "public" | "private";
}): Promise<{ ok: true }> {
  const visibility = input.visibility ?? "private";
  requireOk(
    await execGh({
      cwd: input.cwd,
      args: ["repo", "create", "--source", ".", `--${visibility}`, "--push"],
    }),
    "create GitHub repo",
  );
  return { ok: true };
}

export async function getGhDefaultBranch(input: {
  cwd: string;
}): Promise<string | null> {
  const result = await execGh({
    cwd: input.cwd,
    args: ["repo", "view", "--json", "defaultBranchRef"],
  });
  if (result.code !== 0) return null;
  try {
    const data = JSON.parse(result.stdout) as { defaultBranchRef?: { name?: string } };
    return data.defaultBranchRef?.name ?? null;
  } catch {
    return null;
  }
}

export async function getForkParent(input: { cwd: string }): Promise<string | null> {
  const repo = await readOriginRepoSlug(input.cwd);
  if (!repo) return null;
  const result = await execGh({
    cwd: input.cwd,
    args: ["repo", "view", repo, "--json", "isFork,parent"],
  });
  if (result.code !== 0) return null;
  try {
    const data = JSON.parse(result.stdout) as {
      isFork: boolean;
      parent?: { name: string; owner: { login: string } };
    };
    if (!data.isFork || !data.parent) return null;
    return data.parent.owner.login + "/" + data.parent.name;
  } catch {
    return null;
  }
}

export async function listGhRepos(input: {
  limit?: number;
}): Promise<GhRepo[]> {
  const limit = input.limit ?? 100;
  const result = await execGh({
    cwd: ".",
    args: [
      "repo", "list",
      "--json", "name,nameWithOwner,description,isPrivate,updatedAt",
      "--limit", String(limit),
    ],
  });
  if (result.code !== 0) throw new Error(`Failed to list repos: ${result.stderr}`);
  try {
    return JSON.parse(result.stdout) as GhRepo[];
  } catch {
    throw new Error("Failed to parse repo list");
  }
}

export async function cloneGhRepo(input: {
  repo: string;
  destination: string;
}): Promise<{ clonedPath: string }> {
  const repoName = input.repo.split("/").pop() ?? input.repo;
  const clonedPath = path.join(input.destination, repoName);
  const result = await execGh({
    cwd: input.destination,
    args: ["repo", "clone", input.repo],
    timeoutMs: 120_000,
  });
  if (result.code !== 0) throw new Error(`Clone failed: ${result.stderr}`);
  return { clonedPath };
}

export async function getGhAuthStatus(input: { cwd: string }): Promise<GhAuthStatus> {
  try {
    const result = await execGh({ cwd: input.cwd, args: ["auth", "status"] });
    const output = result.stdout + result.stderr;
    if (result.code === 0 || output.includes("Logged in")) {
      const match = output.match(/Logged in to (.+?) account (.+?)[\s(]/);
      return {
        connected: true,
        detail: match ? match[2] + " on " + match[1] : "Authenticated",
      };
    }
    return {
      connected: false,
      detail: "Run: gh auth login",
    };
  } catch {
    return {
      connected: false,
      detail: "gh CLI not found",
    };
  }
}

export async function getGhViewer(input: { cwd: string }): Promise<GhViewer | null> {
  try {
    const result = await execGh({
      cwd: input.cwd,
      args: ["api", "user", "--jq", "{login: .login, avatarUrl: .avatar_url, url: .html_url}"],
    });
    if (result.code !== 0) return null;
    const parsed = JSON.parse(result.stdout) as Partial<GhViewer>;
    if (!parsed.login || !parsed.avatarUrl || !parsed.url) return null;
    return {
      login: parsed.login,
      avatarUrl: parsed.avatarUrl,
      url: parsed.url,
    };
  } catch {
    return null;
  }
}
