import { execFileSync } from "node:child_process";

const KNOWN_TERMINALS = ["Ghostty", "iTerm", "Warp", "Alacritty", "kitty", "Hyper", "Terminal"];
let cachedDetected: string[] | null = null;

export function detectInstalledTerminals(): string[] {
  if (cachedDetected) return cachedDetected;
  if (process.platform !== "darwin") {
    cachedDetected = ["Terminal"];
    return cachedDetected;
  }
  const found: string[] = [];
  for (const app of KNOWN_TERMINALS) {
    try {
      execFileSync("open", ["-Ra", app], { stdio: "ignore" });
      found.push(app);
    } catch { /* not installed */ }
  }
  cachedDetected = found.length > 0 ? found : ["Terminal"];
  return cachedDetected;
}
