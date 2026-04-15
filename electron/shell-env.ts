import { execFileSync } from "node:child_process";

/**
 * Resolve the user's full shell PATH before anything else — macOS GUI apps
 * don't inherit the login shell's environment, so tools like git/gh/claude
 * and provider auth sockets can disappear in packaged builds.
 */
export function syncShellEnvironment(): void {
  if (process.platform !== "darwin") return;
  try {
    const shell = process.env.SHELL ?? "/bin/zsh";
    const marker = "__BETTERGIT_ENV__";
    const keys = ["PATH", "SSH_AUTH_SOCK"] as const;
    const command = keys.map(
      (key) => `printf '%s' '${marker}${key}='; printenv ${key}; printf '%s' '${marker}'`,
    ).join(";");
    const output = execFileSync(shell, ["-ilc", command], { encoding: "utf8", timeout: 5_000 });

    for (const key of keys) {
      const keyMarker = `${marker}${key}=`;
      const start = output.indexOf(keyMarker);
      if (start === -1) continue;
      const valueStart = start + keyMarker.length;
      const end = output.indexOf(marker, valueStart);
      if (end === -1) continue;
      const value = output.slice(valueStart, end).trim();
      if (value.length > 0) {
        process.env[key] = value;
      }
    }
  } catch {
    // Keep inherited environment if shell lookup fails.
  }
}
