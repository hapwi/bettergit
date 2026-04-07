import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

export const execFileAsync = promisify(execFile);

// Resolve the user's full shell PATH by running their login shell, matching
// hapcode's readPathFromLoginShell approach. This catches everything the user
// has configured in .zshrc/.bashrc (homebrew, nvm, cargo, etc.).
let resolvedPath: string | null = null;

function readPathFromLoginShell(): string | null {
  if (process.platform !== "darwin") return null;
  try {
    const shell = process.env.SHELL ?? "/bin/zsh";
    const marker = "__BETTERGIT_PATH__";
    const output = execFileSync(shell, ["-ilc", `printf '%s' '${marker}'; printenv PATH; printf '%s' '${marker}'`], {
      encoding: "utf8",
      timeout: 5_000,
    });
    const start = output.indexOf(marker);
    if (start === -1) return null;
    const valueStart = start + marker.length;
    const end = output.indexOf(marker, valueStart);
    if (end === -1) return null;
    const pathValue = output.slice(valueStart, end).trim();
    return pathValue.length > 0 ? pathValue : null;
  } catch {
    return null;
  }
}

// Called once at server startup
export function fixPath(): void {
  if (process.platform !== "darwin") return;
  const shellPath = readPathFromLoginShell();
  if (shellPath) {
    resolvedPath = shellPath;
    process.env.PATH = shellPath;
  }
}

export function getEnvWithPath(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (resolvedPath) {
    env.PATH = resolvedPath;
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
