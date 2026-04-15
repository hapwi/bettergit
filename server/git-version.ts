import fs from "node:fs/promises";
import path from "node:path";
import { runProcess, type ExecResult } from "./env";

const LONG_RUNNING_GIT_TIMEOUT_MS = 10 * 60_000;

async function gitRun(cwd: string, args: string[], timeout = LONG_RUNNING_GIT_TIMEOUT_MS) {
  return runProcess("git", args, cwd, timeout);
}

function requireOk(result: ExecResult, label: string) {
  if (result.code !== 0) throw new Error(`${label} failed: ${result.stderr}`);
  return result.stdout;
}

export interface VersionBumpInput {
  cwd: string;
  bump: "patch" | "minor" | "major";
}

export interface VersionBumpResult {
  tag: string;
  version: string;
  error: string | null;
}

async function computeBumpedVersion(cwd: string, bump: "patch" | "minor" | "major") {
  const pkgPath = path.join(cwd, "package.json");
  const raw = await fs.readFile(pkgPath, "utf-8");
  const pkg = JSON.parse(raw) as { version?: string };
  const current = pkg.version ?? "0.0.0";
  const m = current.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) throw new Error(`Invalid version in package.json: ${current}`);

  let [major, minor, patch] = [+m[1], +m[2], +m[3]];
  if (bump === "major") { major++; minor = 0; patch = 0; }
  else if (bump === "minor") { minor++; patch = 0; }
  else { patch++; }

  const newVersion = `${major}.${minor}.${patch}`;
  return { raw, pkgPath, newVersion, tag: `v${newVersion}` };
}

async function commitVersionBump(cwd: string, bump: "patch" | "minor" | "major") {
  const { raw, pkgPath, newVersion, tag } = await computeBumpedVersion(cwd, bump);
  const updated = raw.replace(/"version"\s*:\s*"[^"]*"/, `"version": "${newVersion}"`);
  await fs.writeFile(pkgPath, updated, "utf-8");
  requireOk(await gitRun(cwd, ["add", "package.json"]), "stage package.json");
  requireOk(await gitRun(cwd, ["commit", "-m", `chore: bump version to ${tag}`]), "version commit");
  requireOk(await gitRun(cwd, ["push", "origin", "HEAD"]), "push version bump");
  return tag;
}

async function createAndPushTag(cwd: string, tag: string) {
  requireOk(await gitRun(cwd, ["tag", tag]), "create tag");
  requireOk(await gitRun(cwd, ["push", "origin", tag]), "push tag");
}

export async function versionBump(input: VersionBumpInput): Promise<VersionBumpResult> {
  try {
    const tag = await commitVersionBump(input.cwd, input.bump);
    await createAndPushTag(input.cwd, tag);
    return { tag, version: tag.slice(1), error: null };
  } catch (err) {
    return { tag: "", version: "", error: err instanceof Error ? err.message : "Version bump failed." };
  }
}
