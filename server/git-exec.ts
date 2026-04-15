import { runProcess, type ExecResult } from "./env";

// ---------------------------------------------------------------------------
// Low-level exec
// ---------------------------------------------------------------------------

export interface ExecInput {
  cwd: string;
  args: string[];
  timeoutMs?: number;
}

export async function execGit(input: ExecInput): Promise<ExecResult> {
  return runProcess("git", input.args, input.cwd, input.timeoutMs);
}

export async function execGh(input: ExecInput): Promise<ExecResult> {
  return runProcess("gh", input.args, input.cwd, input.timeoutMs);
}

export async function readOriginRepoSlug(cwd: string): Promise<string> {
  const result = await execGit({ cwd, args: ["remote", "get-url", "origin"] });
  if (result.code !== 0) return "";
  const match = result.stdout.trim().match(/github\.com[/:]([^/]+\/[^/.]+)/);
  return match ? match[1] : "";
}

export function requireOk(result: ExecResult, label: string) {
  if (result.code !== 0) throw new Error(`${label} failed: ${result.stderr}`);
  return result.stdout;
}
