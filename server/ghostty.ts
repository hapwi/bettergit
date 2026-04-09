import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ---------------------------------------------------------------------------
// Ghostty config reader
// ---------------------------------------------------------------------------

export interface GhosttyConfig {
  theme: string | null;
  fontFamily: string | null;
  fontSize: number | null;
  background: string | null;
  foreground: string | null;
  cursorColor: string | null;
  /** Raw key=value pairs for anything else the frontend may want */
  raw: Record<string, string>;
}

const CONFIG_PATHS = [
  path.join(os.homedir(), ".config", "ghostty", "config"),
  path.join(os.homedir(), "Library", "Application Support", "com.mitchellh.ghostty", "config"),
];

function findConfigPath(): string | null {
  for (const p of CONFIG_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function readGhosttyConfig(): GhosttyConfig {
  const configPath = findConfigPath();
  const config: GhosttyConfig = {
    theme: null,
    fontFamily: null,
    fontSize: null,
    background: null,
    foreground: null,
    cursorColor: null,
    raw: {},
  };

  if (!configPath) return config;

  let contents: string;
  try {
    contents = fs.readFileSync(configPath, "utf-8");
  } catch {
    return config;
  }

  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();

    config.raw[key] = value;

    switch (key) {
      case "theme":
        config.theme = value;
        break;
      case "font-family":
        config.fontFamily = value;
        break;
      case "font-size":
        config.fontSize = parseFloat(value) || null;
        break;
      case "background":
        config.background = value;
        break;
      case "foreground":
        config.foreground = value;
        break;
      case "cursor-color":
        config.cursorColor = value;
        break;
    }
  }

  return config;
}
