/**
 * Low-level git/gh command execution via the bettergit server.
 */
import { serverFetch } from "../server";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export async function execGit(
  cwd: string,
  args: string[],
  timeoutMs?: number,
): Promise<ExecResult> {
  return serverFetch("/api/git/exec", { cwd, args, timeoutMs });
}

export async function execGh(
  cwd: string,
  args: string[],
  timeoutMs?: number,
): Promise<ExecResult> {
  return serverFetch("/api/gh/exec", { cwd, args, timeoutMs });
}

export function requireSuccess(result: ExecResult, operation: string): string {
  if (result.code !== 0) {
    throw new Error(`${operation} failed (exit ${result.code}): ${result.stderr}`);
  }
  return result.stdout;
}
