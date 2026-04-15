import { execGh, readOriginRepoSlug, requireOk } from "./git-exec";

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

export interface GhAuthStatus {
  connected: boolean;
  detail: string;
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
