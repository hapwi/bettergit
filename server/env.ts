import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

export const execFileAsync = promisify(execFile);

// Resolve the user's shell environment by running their login shell, matching
// hapcode's desktop sync. Packaged macOS GUI apps often miss both PATH and
// SSH_AUTH_SOCK, which breaks provider CLIs in the DMG while dev works.
const SHELL_ENV_KEYS = ["PATH", "SSH_AUTH_SOCK"] as const;

let resolvedShellEnv: Partial<Record<(typeof SHELL_ENV_KEYS)[number], string>> = {};

function readEnvironmentFromLoginShell(): Partial<Record<(typeof SHELL_ENV_KEYS)[number], string>> {
  if (process.platform !== "darwin") return {};
  try {
    const shell = process.env.SHELL ?? "/bin/zsh";
    const marker = "__BETTERGIT_ENV__";
    const command = SHELL_ENV_KEYS.map(
      (key) => `printf '%s' '${marker}${key}='; printenv ${key}; printf '%s' '${marker}'`,
    ).join(";");
    const output = execFileSync(shell, ["-ilc", command], { encoding: "utf8", timeout: 5_000 });
    const nextEnv: Partial<Record<(typeof SHELL_ENV_KEYS)[number], string>> = {};

    for (const key of SHELL_ENV_KEYS) {
      const keyMarker = `${marker}${key}=`;
      const start = output.indexOf(keyMarker);
      if (start === -1) continue;
      const valueStart = start + keyMarker.length;
      const end = output.indexOf(marker, valueStart);
      if (end === -1) continue;
      const value = output.slice(valueStart, end).trim();
      if (value.length > 0) {
        nextEnv[key] = value;
      }
    }

    return nextEnv;
  } catch {
    return {};
  }
}

// Called once at server startup
export function fixPath(): void {
  if (process.platform !== "darwin") return;
  const shellEnv = readEnvironmentFromLoginShell();
  resolvedShellEnv = shellEnv;
  for (const [key, value] of Object.entries(shellEnv)) {
    if (value) {
      process.env[key] = value;
    }
  }
}

export function getEnvWithPath(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const [key, value] of Object.entries(resolvedShellEnv)) {
    if (value) {
      env[key] = value;
    }
  }
  return env;
}

export type { ExecResult } from "../shared/exec";

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
