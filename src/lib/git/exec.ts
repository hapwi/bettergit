/**
 * Low-level git/gh command execution via Electron IPC.
 */

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

function getAPI() {
  const api = window.electronAPI;
  if (!api) throw new Error("Electron API not available — running outside Electron?");
  return api;
}

export async function execGit(
  cwd: string,
  args: string[],
  timeoutMs?: number,
): Promise<ExecResult> {
  return getAPI().git.exec({ cwd, args, timeoutMs });
}

export async function execGh(
  cwd: string,
  args: string[],
  timeoutMs?: number,
): Promise<ExecResult> {
  return getAPI().gh.exec({ cwd, args, timeoutMs });
}

export function requireSuccess(result: ExecResult, operation: string): string {
  if (result.code !== 0) {
    throw new Error(`${operation} failed (exit ${result.code}): ${result.stderr}`);
  }
  return result.stdout;
}
