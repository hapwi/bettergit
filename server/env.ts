import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const execFileAsync = promisify(execFile);

export function getEnvWithPath(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (process.platform === "darwin") {
    const extraPaths = [
      "/usr/local/bin",
      "/opt/homebrew/bin",
      `${process.env.HOME}/.local/bin`,
      `${process.env.HOME}/.npm-global/bin`,
      `${process.env.HOME}/.cargo/bin`,
    ];
    const currentPath = env.PATH ?? "";
    const missing = extraPaths.filter((p) => !currentPath.includes(p));
    if (missing.length > 0) {
      env.PATH = [...missing, currentPath].join(":");
    }
  }
  return env;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export async function runProcess(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = 30_000,
): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      env: getEnvWithPath(),
    });
    return { code: 0, stdout, stderr };
  } catch (err: unknown) {
    const error = err as { code?: number; stdout?: string; stderr?: string; message?: string };
    return {
      code: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? error.message ?? "Unknown error",
    };
  }
}
