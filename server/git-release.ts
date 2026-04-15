import { execGit } from "./git-exec";
import { listBranches } from "./git-branches";
import { createPullRequest, type PullRequestSummary } from "./git-pr";
import * as ai from "./ai";

function parseSemVer(tag: string): { major: number; minor: number; patch: number } | null {
  const match = tag.replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

export async function getPreReleaseAheadCount(input: { cwd: string }): Promise<number> {
  const { cwd } = input;
  await execGit({ cwd, args: ["fetch", "--quiet", "origin"] });
  const branches = await listBranches({ cwd });
  const mainExists = branches.some((branch) => branch.name === "main" || branch.name === "origin/main");
  const target = mainExists ? "origin/main" : "origin/master";
  const result = await execGit({ cwd, args: ["rev-list", "--count", target + "..pre-release"] });
  if (result.code !== 0) return 0;
  return parseInt(result.stdout.trim(), 10);
}

export async function getCurrentVersion(input: {
  cwd: string;
}): Promise<{ major: number; minor: number; patch: number }> {
  const { cwd } = input;
  await execGit({ cwd, args: ["fetch", "--tags", "--quiet", "origin"] }).catch(() => undefined);
  const result = await execGit({ cwd, args: ["tag", "--sort=-v:refname", "-l", "v*"] });
  const tags = result.stdout.trim().split("\n").filter(Boolean);
  for (const tag of tags) {
    const parsed = parseSemVer(tag);
    if (parsed) return parsed;
  }

  const pkgResult = await execGit({ cwd, args: ["show", "HEAD:package.json"] });
  if (pkgResult.code === 0) {
    try {
      const pkg = JSON.parse(pkgResult.stdout) as { version?: string };
      if (pkg.version) {
        const parsed = parseSemVer(pkg.version);
        if (parsed) return parsed;
      }
    } catch {
      // ignore invalid JSON
    }
  }

  return { major: 0, minor: 0, patch: 0 };
}

export async function getRangeContext(
  cwd: string,
  baseBranch: string,
): Promise<{ commitSummary: string; diffSummary: string; diffPatch: string }> {
  const [commitResult, diffStatResult, diffPatchResult] = await Promise.all([
    execGit({ cwd, args: ["log", baseBranch + "..HEAD", "--oneline", "--no-merges"] }),
    execGit({ cwd, args: ["diff", baseBranch + "...HEAD", "--stat"] }),
    execGit({ cwd, args: ["diff", baseBranch + "...HEAD"] }),
  ]);
  return {
    commitSummary: commitResult.stdout.slice(0, 20_000),
    diffSummary: diffStatResult.stdout.slice(0, 20_000),
    diffPatch: diffPatchResult.stdout.slice(0, 60_000),
  };
}

export async function createReleasePullRequest(input: {
  cwd: string;
}): Promise<PullRequestSummary> {
  const { cwd } = input;
  const branches = await listBranches({ cwd });
  const mainExists = branches.some((branch) => branch.name === "main" || branch.name === "origin/main");
  const targetBranch = mainExists ? "main" : "master";

  const rangeCtx = await getRangeContext(cwd, targetBranch);
  let prTitle = "Release: pre-release -> " + targetBranch;
  let prBody = "";

  try {
    const generated = await ai.generatePrContent({
      cwd,
      baseBranch: targetBranch,
      headBranch: "pre-release",
      commitSummary: rangeCtx.commitSummary,
      diffSummary: rangeCtx.diffSummary,
      diffPatch: rangeCtx.diffPatch,
    });
    prTitle = generated.title;
    prBody = generated.body;
  } catch {
    // fallback title/body
  }

  return createPullRequest({
    cwd,
    baseBranch: targetBranch,
    title: prTitle,
    body: prBody,
  });
}
